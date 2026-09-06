import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PostgresCheckoutDraftRepository,
  runMigrations
} from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresCheckoutDraftRepository(databaseUrl);
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

describe('Postgres checkout drafts', () => {
  it('persists PII fields with conversation version checks', async () => {
    const suffix = randomUUID();
    const created = await pool.query<{ conversation_id: string }>(
      `WITH p AS (
         INSERT INTO pages (meta_page_id, name) VALUES ($1, 'Checkout test') RETURNING id
       ), c AS (
         INSERT INTO customers (page_id, meta_psid) SELECT id, $2 FROM p RETURNING id, page_id
       ), v AS (
         INSERT INTO conversations (page_id, customer_id) SELECT page_id, id FROM c RETURNING id
       ) SELECT id AS conversation_id FROM v`,
      [`checkout-page-${suffix}`, `checkout-customer-${suffix}`]
    );
    const conversationId = created.rows[0]?.conversation_id;
    if (!conversationId)
      throw new Error('Checkout conversation was not created');

    const started = await repository.update({
      conversationId,
      expectedVersion: 1,
      state: 'collecting_name'
    });
    const named = await repository.update({
      conversationId,
      expectedVersion: started.version,
      state: 'collecting_phone',
      recipientName: 'Lan'
    });

    expect(named).toMatchObject({
      conversationId,
      state: 'collecting_phone',
      recipientName: 'Lan'
    });
    await expect(
      repository.update({
        conversationId,
        expectedVersion: started.version,
        state: 'collecting_address'
      })
    ).rejects.toThrow('Checkout version conflict');
  });
});
