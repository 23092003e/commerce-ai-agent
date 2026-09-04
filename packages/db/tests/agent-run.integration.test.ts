import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgresAgentRunRepository, runMigrations } from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresAgentRunRepository(databaseUrl);
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

describe('Postgres agent run tracing', () => {
  it('persists a bounded agent run and safe tool projection', async () => {
    const suffix = randomUUID();
    const seed = await pool.query<{
      conversation_id: string;
      message_id: string;
    }>(
      `WITH page AS (
        INSERT INTO pages (meta_page_id, name) VALUES ($1, 'Trace test') RETURNING id
      ), customer AS (
        INSERT INTO customers (page_id, meta_psid) SELECT id, $2 FROM page RETURNING id, page_id
      ), conversation AS (
        INSERT INTO conversations (page_id, customer_id) SELECT page_id, id FROM customer RETURNING id
      ), message AS (
        INSERT INTO messages (conversation_id, direction, sender_type, message_type, delivery_state)
        SELECT id, 'inbound', 'customer', 'text', 'received' FROM conversation RETURNING id, conversation_id
      ) SELECT conversation_id, id AS message_id FROM message`,
      [`trace-page-${suffix}`, `trace-customer-${suffix}`]
    );
    const context = seed.rows[0];
    if (!context) throw new Error('Trace test context was not created');

    const agentRunId = await repository.start({
      conversationId: context.conversation_id,
      inboundMessageId: context.message_id,
      modelProvider: 'fake',
      modelName: 'scripted',
      promptVersion: 'sales-system.v1'
    });
    await repository.recordToolCall({
      agentRunId,
      toolName: 'catalog.searchProducts',
      arguments: { queryLength: 4 },
      resultSummary: { productCount: 1 },
      status: 'succeeded',
      latencyMs: 12
    });
    await repository.complete({
      agentRunId,
      outcome: 'replied',
      latencyMs: 24,
      inputTokens: 10,
      outputTokens: 5
    });

    const recorded = await pool.query<{
      status: string;
      final_outcome: string;
      arguments: { queryLength: number };
      result_summary: { productCount: number };
    }>(
      `SELECT r.status, r.final_outcome, t.arguments, t.result_summary
       FROM agent_runs r JOIN tool_calls t ON t.agent_run_id = r.id WHERE r.id = $1`,
      [agentRunId]
    );
    expect(recorded.rows).toEqual([
      {
        status: 'completed',
        final_outcome: 'replied',
        arguments: { queryLength: 4 },
        result_summary: { productCount: 1 }
      }
    ]);
  });
});
