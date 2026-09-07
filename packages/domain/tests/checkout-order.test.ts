import {
  createCheckoutOrderConfirmationService,
  type CheckoutDraftRepository,
  type OrderService
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const conversationId = '11111111-1111-4111-8111-111111111111';

function readyDraftRepository(): CheckoutDraftRepository {
  return {
    async get() {
      return {
        conversationId,
        version: 5,
        state: 'awaiting_confirmation',
        recipientName: 'Lan',
        phone: '0900000000',
        address: { line1: '1 Main', ward: 'Ward 1', city: 'HCM' },
        paymentMethod: 'cod'
      };
    },
    async update() {
      throw new Error('not used');
    }
  };
}

describe('checkout order confirmation', () => {
  it('creates a zero-shipping order from a current server-side checkout snapshot', async () => {
    const received: unknown[] = [];
    const orders: OrderService = {
      async createConfirmed(input) {
        received.push(input);
        return { orderId: 'order-1', orderNumber: 'ORD-TEST' };
      }
    };
    const service = createCheckoutOrderConfirmationService({
      confirmationSecret: 'checkout-confirmation-secret-at-least-32-characters',
      checkout: readyDraftRepository(),
      carts: {
        async getActiveForConversation() {
          return {
            id: '22222222-2222-4222-8222-222222222222',
            version: 3,
            currency: 'VND',
            subtotal: 240000,
            total: 240000
          };
        }
      },
      orders
    });

    await expect(service.confirm(conversationId)).resolves.toEqual({
      orderId: 'order-1',
      orderNumber: 'ORD-TEST'
    });
    expect(received).toMatchObject([
      {
        snapshot: {
          cartVersion: 3,
          shippingFee: 0,
          subtotal: 240000,
          total: 240000
        }
      }
    ]);
  });

  it('rejects confirmation before checkout is ready', async () => {
    const checkout = readyDraftRepository();
    checkout.get = async () => ({
      conversationId,
      version: 2,
      state: 'collecting_phone',
      recipientName: 'Lan',
      phone: null,
      address: null,
      paymentMethod: null
    });
    const service = createCheckoutOrderConfirmationService({
      confirmationSecret: 'checkout-confirmation-secret-at-least-32-characters',
      checkout,
      carts: {
        async getActiveForConversation() {
          return {
            id: '22222222-2222-4222-8222-222222222222',
            version: 3,
            currency: 'VND',
            subtotal: 240000,
            total: 240000
          };
        }
      },
      orders: {
        async createConfirmed() {
          throw new Error('not used');
        }
      }
    });

    await expect(service.confirm(conversationId)).rejects.toThrow(
      'Checkout is not ready for confirmation'
    );
  });
});
