import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresCommerceRepository, runMigrations } from '../src/index.js';

const url =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent_test';
const repository = new PostgresCommerceRepository(url);
const pool = new Pool({ connectionString: url });
beforeAll(async () => {
  await runMigrations(
    url,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => {
  await Promise.all([pool.end(), repository.close()]);
});

it('lists only pending states and never automatically replays terminal failures', async () => {
  const prefix = randomUUID();
  const states = [
    'received',
    'queued',
    'processing',
    'processed',
    'ignored',
    'failed'
  ];
  for (const [index, state] of states.entries()) {
    await pool.query(
      'INSERT INTO webhook_events(provider, external_event_key, raw_payload, processing_state) VALUES ($1,$2,$3,$4)',
      ['test', `${prefix}-${String(index)}`, '{}', state]
    );
  }
  const result = (await repository.listRecoverableWebhookEventKeys(100)).filter(
    (key) => key.startsWith(prefix)
  );
  expect(result.sort()).toEqual([`${prefix}-0`, `${prefix}-1`, `${prefix}-2`]);
});
