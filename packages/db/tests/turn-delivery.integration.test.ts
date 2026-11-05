import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/migrate.js';
import { PostgresOutboundMessageRepository } from '../src/outbound-message-postgres.js';
import { PostgresAgentRunRepository } from '../src/agent-run-postgres.js';
import { PostgresHandoverRepository } from '../src/handover-postgres.js';

const url =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const pool = new Pool({ connectionString: url });
const outbound = new PostgresOutboundMessageRepository(url);
const runs = new PostgresAgentRunRepository(url);
beforeAll(async () => {
  await runMigrations(
    url,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => {
  await Promise.all([outbound.close(), runs.close(), pool.end()]);
});

describe('durable outbound', () => {
  it('preserves planned text and enforces conservative delivery transitions and one run', async () => {
    const key = randomUUID();
    const seed = await pool.query<{ id: string; conversation_id: string }>(
      `WITH p AS (INSERT INTO pages(meta_page_id,name) VALUES($1,'test') RETURNING id), c AS (INSERT INTO customers(page_id,meta_psid) SELECT id,$1 FROM p RETURNING id,page_id), v AS (INSERT INTO conversations(page_id,customer_id) SELECT page_id,id FROM c RETURNING id), m AS (INSERT INTO messages(conversation_id,direction,sender_type,message_type,delivery_state) SELECT id,'inbound','customer','text','received' FROM v RETURNING id,conversation_id) SELECT * FROM m`,
      [key]
    );
    const row = seed.rows[0];
    if (!row) throw new Error('Seed missing');
    const input = {
      conversationId: row.conversation_id,
      inboundMessageId: row.id,
      recipientId: 'recipient',
      outboundKey: key,
      text: 'immutable'
    };
    const first = await outbound.planText(input);
    expect(await outbound.planText({ ...input, text: 'changed' })).toEqual(
      first
    );
    expect(await outbound.claimForSend(first.id)).toBe('claimed');
    await outbound.markRetryable(first.id, 'rate_limited', 'x'.repeat(2000));
    expect(await outbound.claimForSend(first.id)).toBe('claimed');
    expect(await outbound.claimForSend(first.id)).toBe('uncertain');
    expect(
      (await outbound.findByInboundMessage(input.inboundMessageId))
        ?.deliveryState
    ).toBe('unknown');
    const runInput = {
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId,
      modelProvider: 'fake',
      modelName: 'fake',
      promptVersion: 'v1'
    };
    expect(await runs.start(runInput)).toBe(await runs.start(runInput));
    const count = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM agent_runs WHERE inbound_message_id=$1',
      [input.inboundMessageId]
    );
    expect(count.rows[0]?.count).toBe(1);
    const plannedBeforeTakeover = await outbound.planText({
      ...input,
      outboundKey: `${key}-takeover`
    });
    const controls = new PostgresHandoverRepository(url);
    try {
      await controls.takeOver({
        conversationId: input.conversationId,
        expectedVersion: 1,
        adminActor: 'test-admin'
      });
      expect(await outbound.claimForSend(plannedBeforeTakeover.id)).toBe(
        'suppressed'
      );
      const blocked = await pool.query(
        'SELECT delivery_state,last_error_code,attempts FROM messages WHERE id=$1',
        [plannedBeforeTakeover.id]
      );
      expect(blocked.rows[0]).toMatchObject({
        delivery_state: 'failed',
        last_error_code: 'human_controlled',
        attempts: 0
      });
      expect(await outbound.claimForSend(plannedBeforeTakeover.id)).toBe(
        'suppressed'
      );
    } finally {
      await controls.close();
    }
  });
});
