import { describe, expect, it } from 'vitest';
import {
  createCheckoutConfirmation,
  createOrderService
} from '../src/index.js';
const secret = 'checkout-test-secret-that-is-at-least-thirty-two-characters';
const snapshot = {
  conversationId: '33333333-3333-4333-8333-333333333333',
  nonce: 'unique-preparation',
  preparedAt: 1800000000000,
  expiresAt: 1800000900000,
  lines: [
    {
      productId: '44444444-4444-4444-8444-444444444444',
      variantId: '55555555-5555-4555-8555-555555555555',
      sku: 'POLO',
      productName: 'Polo',
      variantName: 'Large',
      quantity: 2,
      unitPrice: 449000,
      lineTotal: 898000
    }
  ],
  cartId: '11111111-1111-4111-8111-111111111111',
  cartVersion: 2,
  recipientName: 'Lan',
  phone: '0900000000',
  address: { line1: '1 Main St', ward: 'Ward 1', city: 'HCM' },
  paymentMethod: 'cod',
  currency: 'VND',
  subtotal: 898000,
  shippingFee: 30000,
  discountTotal: 0,
  total: 928000
};
describe('order confirmation gate', () => {
  it('requires a prepared line-level confirmation before repository calls', async () => {
    const service = createOrderService({
      confirmationSecret: secret,
      repository: {
        async createConfirmed() {
          throw new Error('repository should not be called');
        }
      }
    });
    const unprepared = { ...snapshot, lines: undefined };
    const signed = createCheckoutConfirmation(secret, unprepared);
    await expect(
      service.createConfirmed(signed, snapshot.preparedAt + 1000)
    ).rejects.toThrow('lines');
  });
  it('never calls the repository with a stale confirmation', async () => {
    let calls = 0;
    const service = createOrderService({
      confirmationSecret: secret,
      repository: {
        async createConfirmed() {
          calls += 1;
          return {
            orderId: '22222222-2222-4222-8222-222222222222',
            orderNumber: 'ORD-1'
          };
        }
      }
    });
    const confirmationId = createCheckoutConfirmation(
      secret,
      snapshot
    ).confirmationId;
    await expect(
      service.createConfirmed(
        {
          confirmationId,
          snapshot: { ...snapshot, cartVersion: 3 }
        },
        snapshot.preparedAt + 1000
      )
    ).rejects.toThrow('invalid or stale');
    expect(calls).toBe(0);
    await expect(
      service.createConfirmed(
        { confirmationId, snapshot },
        snapshot.preparedAt + 1000
      )
    ).resolves.toEqual({
      orderId: '22222222-2222-4222-8222-222222222222',
      orderNumber: 'ORD-1'
    });
    expect(calls).toBe(1);
  });
});
