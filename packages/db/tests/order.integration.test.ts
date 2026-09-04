import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createCheckoutConfirmation,
  createOrderService
} from '@fanpage/domain';
import {
  PostgresCartRepository,
  PostgresOrderRepository,
  runMigrations
} from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const cartRepository = new PostgresCartRepository(databaseUrl);
const orderRepository = new PostgresOrderRepository(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const secret = 'checkout-integration-secret-that-is-at-least-thirty-two-chars';
beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => {
  await cartRepository.close();
  await orderRepository.close();
  await pool.end();
});
describe('Postgres confirmed orders', () => {
  it('creates an order only for a current confirmation and reserves inventory', async () => {
    const suffix = randomUUID();
    const seeded = await pool.query<{
      customer_id: string;
      conversation_id: string;
      product_id: string;
      variant_id: string;
      available: number;
    }>(
      `WITH p AS (INSERT INTO pages (meta_page_id, name) VALUES ($1, 'Order test') RETURNING id), c AS (INSERT INTO customers (page_id, meta_psid) SELECT id, $2 FROM p RETURNING id, page_id), v AS (INSERT INTO conversations (page_id, customer_id) SELECT page_id, id FROM c RETURNING id)
     SELECT c.id AS customer_id, v.id AS conversation_id, pv.product_id, pv.id AS variant_id, i.quantity_available - i.quantity_reserved AS available FROM c CROSS JOIN v CROSS JOIN product_variants pv JOIN inventory i ON i.variant_id = pv.id WHERE pv.sku = 'DEMO-POLO-WHT-M'`,
      [`order-page-${suffix}`, `order-customer-${suffix}`]
    );
    const context = seeded.rows[0];
    if (!context) throw new Error('Order context missing');
    const cart = await cartRepository.upsertLine({
      customerId: context.customer_id,
      conversationId: context.conversation_id,
      productId: context.product_id,
      variantId: context.variant_id,
      sku: 'DEMO-POLO-WHT-M',
      title: 'White / M',
      quantity: 1,
      unitPrice: 449000,
      currency: 'VND'
    });
    const version = await pool.query<{ version: number }>(
      'SELECT version FROM carts WHERE id = $1',
      [cart.id]
    );
    const snapshot = {
      cartId: cart.id,
      cartVersion: version.rows[0]?.version ?? 0,
      recipientName: 'Lan',
      phone: '0900000000',
      address: { line1: '1 Main', ward: 'Ward 1', city: 'HCM' },
      paymentMethod: 'cod' as const,
      currency: 'VND',
      subtotal: cart.subtotal,
      shippingFee: 0,
      discountTotal: 0,
      total: cart.total
    };
    const confirmationId = createCheckoutConfirmation(
      secret,
      snapshot
    ).confirmationId;
    const service = createOrderService({
      confirmationSecret: secret,
      repository: orderRepository
    });
    const order = await service.createConfirmed({ confirmationId, snapshot });
    expect(order.orderNumber).toMatch(/^ORD-/u);
    const inventory = await pool.query<{ available: number }>(
      'SELECT quantity_available - quantity_reserved AS available FROM inventory WHERE variant_id = $1',
      [context.variant_id]
    );
    expect(inventory.rows[0]?.available).toBe(context.available - 1);
    await expect(
      service.createConfirmed({ confirmationId, snapshot })
    ).rejects.toThrow('stale');
  });
});
