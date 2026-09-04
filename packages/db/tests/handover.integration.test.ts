import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgresHandoverRepository, runMigrations } from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresHandoverRepository(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => {
  await repository.close();
  await pool.end();
});
describe('Postgres handover', () => {
  it('moves control from AI to human and explicitly back', async () => {
    const suffix = randomUUID();
    const seeded = await pool.query<{ id: string; version: number }>(
      `WITH p AS (INSERT INTO pages (meta_page_id, name) VALUES ($1, 'Handover') RETURNING id), c AS (INSERT INTO customers (page_id, meta_psid) SELECT id, $2 FROM p RETURNING id, page_id) INSERT INTO conversations (page_id, customer_id) SELECT page_id, id FROM c RETURNING id, version`,
      [`handover-page-${suffix}`, `handover-customer-${suffix}`]
    );
    const conversation = seeded.rows[0];
    if (!conversation) throw new Error('Conversation missing');
    const requested = await repository.request({
      conversationId: conversation.id,
      expectedVersion: conversation.version,
      reason: 'customer_requested'
    });
    expect(requested.version).toBe(conversation.version + 1);
    await expect(
      repository.resolve({
        conversationId: conversation.id,
        expectedVersion: requested.version
      })
    ).resolves.toEqual({ version: requested.version + 1 });
    const final = await pool.query<{ control_mode: string }>(
      'SELECT control_mode FROM conversations WHERE id = $1',
      [conversation.id]
    );
    expect(final.rows[0]?.control_mode).toBe('ai');
  });
});
