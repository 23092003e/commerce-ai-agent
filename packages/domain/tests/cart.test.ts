import { describe, expect, it } from 'vitest';
import { createCartService } from '../src/index.js';

const customerId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const variantId = '33333333-3333-4333-8333-333333333333';

describe('cart service', () => {
  it('uses catalog price and rejects an LLM-supplied price', async () => {
    const service = createCartService({
      catalog: {
        async getVariant() {
          return {
            variantId,
            productId: '44444444-4444-4444-8444-444444444444',
            sku: 'POLO-L',
            title: 'Black / L',
            color: 'black',
            size: 'L',
            price: 449000,
            currency: 'VND',
            available: true,
            availableQuantity: 8
          };
        },
        async searchProducts() {
          return { products: [] };
        },
        async getProduct() {
          return null;
        },
        async checkInventory() {
          return null;
        }
      },
      repository: {
        async upsertLine(input) {
          return {
            id: '55555555-5555-4555-8555-555555555555',
            currency: input.currency,
            lines: [{ ...input, lineTotal: input.quantity * input.unitPrice }],
            subtotal: input.quantity * input.unitPrice,
            total: input.quantity * input.unitPrice
          };
        },
        async setLineQuantity() {
          throw new Error('not used');
        },
        async removeLine() {
          return undefined;
        }
      }
    });
    await expect(
      service.add({
        customerId,
        conversationId,
        variantId,
        quantity: 2,
        unitPrice: 1
      })
    ).rejects.toThrow('Unrecognized key');
    const cart = await service.add({
      customerId,
      conversationId,
      variantId,
      quantity: 2
    });
    expect(cart.total).toBe(898000);
    expect(cart.lines[0]?.unitPrice).toBe(449000);
  });
});
