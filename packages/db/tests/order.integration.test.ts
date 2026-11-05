import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createOrderService,
  renderPreparedCheckoutConfirmation,
  type PreparedCheckoutConfirmation
} from '@fanpage/domain';
import {
  PostgresCartRepository,
  PostgresCheckoutDraftRepository,
  PostgresOrderRepository,
  runMigrations
} from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCommerceFixture } from './commerce-fixture.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const carts = new PostgresCartRepository(databaseUrl);
const checkout = new PostgresCheckoutDraftRepository(databaseUrl);
const repository = new PostgresOrderRepository(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const secret = 'checkout-integration-secret-at-least-thirty-two-characters';
const orders = createOrderService({ confirmationSecret: secret, repository });
beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => {
  await carts.close();
  await checkout.close();
  await repository.close();
  await pool.end();
});

async function prepare(
  owner: Awaited<ReturnType<typeof seedCommerceFixture>>,
  preparedAt = Date.now(),
  publish = true
) {
  const cart = await carts.upsertLine({ ...owner, quantity: 1 });
  await checkout.update({
    conversationId: owner.conversationId,
    expectedVersion: 1,
    state: 'awaiting_confirmation',
    recipientName: 'Lan',
    phone: '0900000000',
    address: { line1: '1 Main', ward: 'Ward', city: 'HCM' },
    paymentMethod: 'cod'
  });
  const confirmation = await checkout.prepare({
    conversationId: owner.conversationId,
    confirmationSecret: secret,
    preparedAt,
    expiresAt: preparedAt + 900000,
    nonce: randomUUID()
  });
  if (publish) {
    const text = renderPreparedCheckoutConfirmation(confirmation);
    const row = await pool.query<{ id: string }>(
      `INSERT INTO messages (conversation_id,direction,sender_type,message_type,delivery_state,text,sent_at) VALUES ($1,'outbound','ai','text','sent',$2,clock_timestamp()) RETURNING id`,
      [owner.conversationId, text]
    );
    const id = row.rows[0]?.id;
    if (!id) throw new Error('Summary fixture missing');
    await expect(
      checkout.linkSummary({
        conversationId: owner.conversationId,
        confirmationId: confirmation.confirmationId,
        messageId: id,
        text: 'wrong summary'
      })
    ).rejects.toThrow('confirmation_stale');
    await checkout.linkSummary({
      conversationId: owner.conversationId,
      confirmationId: confirmation.confirmationId,
      messageId: id,
      text
    });
  }
  return { cart, confirmation };
}

async function assertNoOrder(confirmation: PreparedCheckoutConfirmation) {
  expect(
    (
      await pool.query('SELECT id FROM orders WHERE confirmation_id=$1', [
        confirmation.confirmationId
      ])
    ).rowCount
  ).toBe(0);
  const stock = await pool.query<{ quantity_reserved: number }>(
    'SELECT quantity_reserved FROM inventory WHERE variant_id=$1',
    [confirmation.snapshot.lines[0]?.variantId]
  );
  expect(stock.rows[0]?.quantity_reserved).toBe(0);
}

describe('current-truth confirmed orders', () => {
  it('rejects consent when prepared summary was never sent or was sent after consent', async () => {
    const owner = await seedCommerceFixture(pool);
    const { confirmation } = await prepare(owner, Date.now(), false);
    const text = renderPreparedCheckoutConfirmation(confirmation);
    const row = await pool.query<{ id: string }>(
      `INSERT INTO messages (conversation_id,direction,sender_type,message_type,delivery_state,text) VALUES ($1,'outbound','ai','text','queued',$2) RETURNING id`,
      [owner.conversationId, text]
    );
    const id = row.rows[0]?.id;
    if (!id) throw new Error('Summary fixture missing');
    await checkout.linkSummary({
      conversationId: owner.conversationId,
      confirmationId: confirmation.confirmationId,
      messageId: id,
      text
    });
    const consentAt = Date.now();
    await expect(
      orders.createConfirmed(confirmation, consentAt + 1000)
    ).rejects.toThrow('confirmation_stale');
    await pool.query(
      `UPDATE messages SET delivery_state='unknown' WHERE id=$1`,
      [id]
    );
    await expect(
      orders.createConfirmed(confirmation, consentAt + 1000)
    ).rejects.toThrow('confirmation_stale');
    await pool.query(
      `UPDATE messages SET delivery_state='sent',sent_at=to_timestamp($2::double precision / 1000.0) WHERE id=$1`,
      [id, consentAt + 1000]
    );
    await expect(
      orders.createConfirmed(confirmation, consentAt)
    ).rejects.toThrow('confirmation_stale');
    await assertNoOrder(confirmation);
  });
  it.each([
    'price',
    'inactive',
    'cart',
    'stock',
    'expired',
    'consumed'
  ] as const)(
    'rejects %s changes without partial order or inventory',
    async (change) => {
      const owner = await seedCommerceFixture(pool);
      const { confirmation } = await prepare(
        owner,
        change === 'expired' ? Date.now() - 900001 : Date.now()
      );
      if (change === 'price')
        await pool.query(
          'UPDATE product_variants SET price=price+1 WHERE id=$1',
          [owner.variantId]
        );
      if (change === 'inactive')
        await pool.query(
          "UPDATE product_variants SET status='inactive' WHERE id=$1",
          [owner.variantId]
        );
      if (change === 'cart')
        await carts.setLineQuantity({
          customerId: owner.customerId,
          conversationId: owner.conversationId,
          variantId: owner.variantId,
          quantity: 2
        });
      if (change === 'stock')
        await pool.query(
          'UPDATE inventory SET quantity_available=0 WHERE variant_id=$1',
          [owner.variantId]
        );
      if (change === 'consumed')
        await pool.query(
          'UPDATE checkout_drafts SET confirmation_consumed_at=now() WHERE conversation_id=$1',
          [owner.conversationId]
        );
      await expect(
        orders.createConfirmed(confirmation, Date.now() + 1000)
      ).rejects.toThrow(
        change === 'expired'
          ? 'confirmation_expired'
          : change === 'consumed'
            ? 'confirmation_consumed'
            : change === 'stock'
              ? 'inventory_unavailable'
              : 'confirmation_stale'
      );
      await assertNoOrder(confirmation);
    }
  );

  it('requires the exact persisted confirmation rather than just a signed snapshot', async () => {
    const owner = await seedCommerceFixture(pool);
    const { confirmation } = await prepare(owner);
    await checkout.invalidate(owner.conversationId);
    await expect(
      orders.createConfirmed(confirmation, Date.now() + 1000)
    ).rejects.toThrow('confirmation_stale');
    await assertNoOrder(confirmation);
  });

  it('concurrent replay creates one confirmed order, consumes checkout and permits a second checkout', async () => {
    const owner = await seedCommerceFixture(pool);
    const { cart, confirmation } = await prepare(owner);
    const [first, second] = await Promise.all([
      orders.createConfirmed(confirmation, Date.now() + 1000),
      orders.createConfirmed(confirmation, Date.now() + 1000)
    ]);
    expect(first.orderId).toBe(second.orderId);
    expect(first.orderNumber).toBe(second.orderNumber);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    const state = await pool.query<{
      status: string;
      checkout_state: string;
      cart_status: string;
      confirmation_consumed_at: Date | null;
      quantity_reserved: number;
    }>(
      `SELECT o.status,c.checkout_state,ca.status AS cart_status,d.confirmation_consumed_at,i.quantity_reserved FROM orders o JOIN conversations c ON c.id=o.conversation_id JOIN checkout_drafts d ON d.conversation_id=c.id JOIN carts ca ON ca.id=$2 JOIN inventory i ON i.variant_id=$3 WHERE o.id=$1`,
      [first.orderId, cart.id, owner.variantId]
    );
    expect(state.rows[0]).toMatchObject({
      status: 'confirmed',
      checkout_state: 'none',
      cart_status: 'converted',
      quantity_reserved: 1
    });
    expect(state.rows[0]?.confirmation_consumed_at).toBeInstanceOf(Date);
    expect(await checkout.getPrepared(owner.conversationId)).toBeNull();
    const next = await carts.upsertLine({ ...owner, quantity: 1 });
    expect(next.id).not.toBe(cart.id);
    const draft = await checkout.get(owner.conversationId);
    expect(draft?.state).toBe('none');
    const started = await checkout.update({
      conversationId: owner.conversationId,
      expectedVersion: draft?.version ?? 0,
      state: 'collecting_name'
    });
    expect(started.state).toBe('collecting_name');
  });

  it('two confirmations competing for the final unit reserve only one', async () => {
    const owner = await seedCommerceFixture(pool, 1);
    const other = await seedCommerceFixture(pool);
    const shared = {
      ...other,
      productId: owner.productId,
      variantId: owner.variantId,
      sku: owner.sku
    };
    const first = await prepare(owner);
    const second = await prepare(shared);
    const outcomes = await Promise.allSettled([
      orders.createConfirmed(first.confirmation, Date.now() + 1000),
      orders.createConfirmed(second.confirmation, Date.now() + 1000)
    ]);
    expect(
      outcomes.filter((value) => value.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      outcomes.filter((value) => value.status === 'rejected')
    ).toHaveLength(1);
    const failure = outcomes.find((value) => value.status === 'rejected');
    expect(
      failure?.status === 'rejected' ? String(failure.reason) : ''
    ).toContain('inventory_unavailable');
    const stock = await pool.query<{ quantity_reserved: number }>(
      'SELECT quantity_reserved FROM inventory WHERE variant_id=$1',
      [owner.variantId]
    );
    expect(stock.rows[0]?.quantity_reserved).toBe(1);
  });
});
