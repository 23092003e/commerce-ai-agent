import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgresCartRepository, runMigrations } from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresCartRepository(databaseUrl);
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

describe('Postgres cart', () => {
  it('persists a single active cart and recalculates server totals', async () => {
    const suffix = randomUUID();
    const seeded = await pool.query<{
      customer_id: string;
      conversation_id: string;
      product_id: string;
      variant_id: string;
    }>(
      `WITH p AS (INSERT INTO pages (meta_page_id, name) VALUES ($1, 'Cart test') RETURNING id),
       c AS (INSERT INTO customers (page_id, meta_psid) SELECT id, $2 FROM p RETURNING id, page_id),
       v AS (INSERT INTO conversations (page_id, customer_id) SELECT page_id, id FROM c RETURNING id)
       SELECT c.id AS customer_id, v.id AS conversation_id, pv.product_id, pv.id AS variant_id
       FROM c CROSS JOIN v CROSS JOIN product_variants pv WHERE pv.sku = 'DEMO-POLO-BLK-L'`,
      [`cart-page-${suffix}`, `cart-customer-${suffix}`]
    );
    const input = seeded.rows[0];
    if (!input) throw new Error('Cart test context was not created');
    const base = {
      customerId: input.customer_id,
      conversationId: input.conversation_id,
      productId: input.product_id,
      variantId: input.variant_id,
      sku: 'DEMO-POLO-BLK-L',
      title: 'Black / L',
      unitPrice: 449000,
      currency: 'VND'
    };
    const first = await repository.upsertLine({ ...base, quantity: 2 });
    const updated = await repository.upsertLine({ ...base, quantity: 3 });
    expect(first.total).toBe(898000);
    expect(updated.id).toBe(first.id);
    expect(updated.total).toBe(1347000);
    expect(updated.lines).toHaveLength(1);
  });
});
