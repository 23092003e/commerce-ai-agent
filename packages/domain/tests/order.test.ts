import { describe, expect, it } from 'vitest';
import {
  createCheckoutConfirmation,
  createOrderService
} from '../src/index.js';
const secret = 'checkout-test-secret-that-is-at-least-thirty-two-characters';
const snapshot = {
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
      service.createConfirmed({
        confirmationId,
        snapshot: { ...snapshot, cartVersion: 3 }
      })
    ).rejects.toThrow('invalid or stale');
    expect(calls).toBe(0);
    await expect(
      service.createConfirmed({ confirmationId, snapshot })
    ).resolves.toEqual({
      orderId: '22222222-2222-4222-8222-222222222222',
      orderNumber: 'ORD-1'
    });
    expect(calls).toBe(1);
  });
});
