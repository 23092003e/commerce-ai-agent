import { describe, expect, it } from 'vitest';
import {
  createCheckoutConfirmation,
  verifyCheckoutConfirmation
} from '../src/checkout.js';
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
describe('checkout confirmation', () => {
  it('only verifies the exact current checkout snapshot', () => {
    const confirmation = createCheckoutConfirmation(secret, snapshot);
    expect(
      verifyCheckoutConfirmation(secret, snapshot, confirmation.confirmationId)
    ).toBe(true);
    expect(
      verifyCheckoutConfirmation(
        secret,
        { ...snapshot, cartVersion: 3 },
        confirmation.confirmationId
      )
    ).toBe(false);
  });
});
