import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PostgresCheckoutDraftRepository,
  runMigrations
} from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCommerceFixture } from './commerce-fixture.js';
import { PostgresCartRepository } from '../src/cart-postgres.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresCheckoutDraftRepository(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const carts = new PostgresCartRepository(databaseUrl);
const secret = 'checkout-confirmation-integration-secret-at-least-32';

beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});

afterAll(async () => {
  await repository.close();
  await carts.close();
  await pool.end();
});

describe('Postgres checkout drafts', () => {
  it('prepares current prices and invalidates the immutable summary on cart or field mutation', async () => {
    const owner = await seedCommerceFixture(pool);
    const cart = await carts.upsertLine({ ...owner, quantity: 2 });
    const draft = await repository.update({
      conversationId: owner.conversationId,
      expectedVersion: 1,
      state: 'awaiting_confirmation',
      recipientName: 'Lan',
      phone: '0900000000',
      address: { line1: '1 Main', ward: 'Ward', city: 'HCM' },
      paymentMethod: 'cod'
    });
    await pool.query('UPDATE product_variants SET price=130000 WHERE id=$1', [
      owner.variantId
    ]);
    const preparedAt = Date.now();
    const prepared = await repository.prepare({
      conversationId: owner.conversationId,
      confirmationSecret: secret,
      preparedAt,
      expiresAt: preparedAt + 900000,
      nonce: randomUUID()
    });
    expect(prepared.snapshot.subtotal).toBe(260000);
    expect(prepared.snapshot.lines[0]).toMatchObject({
      quantity: 2,
      unitPrice: 130000,
      lineTotal: 260000
    });
    expect(prepared.snapshot.cartVersion).toBeGreaterThan(1);
    const stored = await repository.getPrepared(owner.conversationId);
    expect(stored).toEqual(prepared);
    const firstLine = prepared.snapshot.lines[0];
    if (!firstLine) throw new Error('Missing fixture line');
    firstLine.quantity = 99;
    expect(
      (await repository.getPrepared(owner.conversationId))?.snapshot.lines[0]
        ?.quantity
    ).toBe(2);
    await carts.setLineQuantity({
      customerId: owner.customerId,
      conversationId: owner.conversationId,
      variantId: owner.variantId,
      quantity: 1
    });
    expect(await repository.getPrepared(owner.conversationId)).toBeNull();
    const second = await repository.prepare({
      conversationId: owner.conversationId,
      confirmationSecret: secret,
      preparedAt,
      expiresAt: preparedAt + 900000,
      nonce: randomUUID()
    });
    expect(second.confirmationId).not.toBe(stored?.confirmationId);
    await repository.update({
      conversationId: owner.conversationId,
      expectedVersion: draft.version,
      state: 'awaiting_confirmation',
      recipientName: 'Mai'
    });
    expect(await repository.getPrepared(owner.conversationId)).toBeNull();
    expect(
      (await carts.getActiveForConversation(owner.conversationId))?.id
    ).toBe(cart.id);
  });
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
