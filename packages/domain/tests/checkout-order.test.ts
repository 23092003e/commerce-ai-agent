import { describe, expect, it, vi } from 'vitest';
import {
  createCheckoutOrderConfirmationService,
  renderPreparedCheckoutConfirmation
} from '../src/checkout-order.js';
import { createPreparedCheckoutConfirmation } from '../src/checkout.js';

const conversationId = '11111111-1111-4111-8111-111111111111';
const secret = 'checkout-confirmation-secret-at-least-32-characters';
const now = 1_800_000_000_000;
const snapshot = {
  conversationId,
  nonce: 'unique-preparation',
  preparedAt: now,
  expiresAt: now + 900_000,
  cartId: '22222222-2222-4222-8222-222222222222',
  cartVersion: 3,
  recipientName: 'Lan',
  phone: '0900000000',
  address: { line1: '1 Main', ward: 'Ward 1', city: 'HCM' },
  paymentMethod: 'cod' as const,
  currency: 'VND',
  subtotal: 240000,
  shippingFee: 0,
  discountTotal: 0,
  total: 240000,
  lines: [
    {
      productId: '33333333-3333-4333-8333-333333333333',
      variantId: '44444444-4444-4444-8444-444444444444',
      sku: 'CAKE',
      productName: 'Cake',
      variantName: 'Small',
      quantity: 2,
      unitPrice: 120000,
      lineTotal: 240000
    }
  ]
};

function setup() {
  let stored: ReturnType<typeof createPreparedCheckoutConfirmation> | null =
    null;
  const orders = {
    createConfirmed: vi.fn(async () => ({
      orderId: 'order-1',
      orderNumber: 'ORD-TEST'
    }))
  };
  const confirmations = {
    prepare: vi.fn(
      async (input: {
        preparedAt: number;
        expiresAt: number;
        nonce: string;
      }) => {
        stored = createPreparedCheckoutConfirmation(secret, {
          ...snapshot,
          preparedAt: input.preparedAt,
          expiresAt: input.expiresAt,
          nonce: input.nonce
        });
        return structuredClone(stored);
      }
    ),
    getPrepared: vi.fn(async () => structuredClone(stored)),
    linkSummary: vi.fn(async () => {}),
    invalidate: vi.fn(async () => {
      stored = null;
    })
  };
  const service = createCheckoutOrderConfirmationService({
    confirmationSecret: secret,
    confirmations,
    orders,
    now: () => now
  });
  return { service, confirmations, orders };
}

describe('prepared checkout confirmation', () => {
  it('forwards the consent timestamp into the transactional order gate', async () => {
    const { service, orders } = setup();
    const prepared = await service.prepareConfirmation(conversationId);
    await service.confirmPrepared({
      conversationId,
      confirmationId: prepared.confirmationId,
      confirmationMessageTimestamp: now + 1
    });
    expect(orders.createConfirmed).toHaveBeenCalledWith(prepared, now + 1);
  });
  it('persists a unique immutable snapshot with a 15-minute expiry before confirmation', async () => {
    const { service, confirmations, orders } = setup();
    const first = await service.prepareConfirmation(conversationId);
    expect(first.snapshot.preparedAt).toBe(now);
    expect(first.snapshot.expiresAt).toBe(now + 900_000);
    const firstLine = first.snapshot.lines[0];
    if (!firstLine) throw new Error('Missing fixture line');
    firstLine.quantity = 99;
    expect(
      (await service.getPrepared(conversationId))?.snapshot.lines[0]?.quantity
    ).toBe(2);
    const second = await service.prepareConfirmation(conversationId);
    expect(second.confirmationId).not.toBe(first.confirmationId);
    expect(confirmations.prepare).toHaveBeenCalledTimes(2);
    expect(orders.createConfirmed).not.toHaveBeenCalled();
  });

  it('never prepares a new snapshot in response to consent and requires stored ID and later timestamp', async () => {
    const { service, orders } = setup();
    await expect(
      service.confirmPrepared({
        conversationId,
        confirmationId: 'missing',
        confirmationMessageTimestamp: now + 1
      })
    ).rejects.toMatchObject({ code: 'confirmation_stale' });
    const prepared = await service.prepareConfirmation(conversationId);
    await expect(
      service.confirmPrepared({
        conversationId,
        confirmationId: 'other',
        confirmationMessageTimestamp: now + 1
      })
    ).rejects.toThrow('confirmation_stale');
    await expect(
      service.confirmPrepared({
        conversationId,
        confirmationId: prepared.confirmationId,
        confirmationMessageTimestamp: now
      })
    ).rejects.toThrow('confirmation_stale');
    expect(orders.createConfirmed).not.toHaveBeenCalled();
    await expect(
      service.confirmPrepared({
        conversationId,
        confirmationId: prepared.confirmationId,
        confirmationMessageTimestamp: now + 1
      })
    ).resolves.toEqual({ orderId: 'order-1', orderNumber: 'ORD-TEST' });
    expect(orders.createConfirmed).toHaveBeenCalledWith(prepared, now + 1);
  });

  it('rejects expired confirmation without creating an order', async () => {
    const { confirmations, orders, service } = setup();
    const prepared = await service.prepareConfirmation(conversationId);
    const expiredService = createCheckoutOrderConfirmationService({
      confirmationSecret: secret,
      confirmations,
      orders,
      now: () => now + 900_000
    });
    await expect(
      expiredService.confirmPrepared({
        conversationId,
        confirmationId: prepared.confirmationId,
        confirmationMessageTimestamp: now + 1
      })
    ).rejects.toThrow('confirmation_expired');
    expect(orders.createConfirmed).not.toHaveBeenCalled();
  });

  it('renders exact persisted lines, totals and delivery fields while redacting phone', async () => {
    const prepared = await setup().service.prepareConfirmation(conversationId);
    const text = renderPreparedCheckoutConfirmation(prepared);
    expect(text).toContain('Vui lòng xác nhận đơn hàng');
    expect(text).toContain('xác nhận');
    for (const value of [
      'Cake',
      'Small',
      '120000',
      '240000',
      'VND',
      'Lan',
      '1 Main',
      'Ward 1',
      'HCM',
      'cod',
      '0000'
    ])
      expect(text).toContain(value);
    expect(text).not.toContain('0900000000');
  });
});
