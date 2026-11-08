import { z } from 'zod';
import { CheckoutConfirmationError } from './checkout.js';
import type { CatalogService } from './catalog.js';

const CartMutationSchema = z
  .object({
    customerId: z.uuid(),
    conversationId: z.uuid(),
    variantId: z.uuid(),
    quantity: z.number().int().min(1).max(99)
  })
  .strict();
const CartLineMutationSchema = CartMutationSchema;
const RemoveCartLineSchema = CartLineMutationSchema.omit({ quantity: true });

export interface CartLine {
  productId: string;
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}
export interface Cart {
  id: string;
  currency: string;
  lines: CartLine[];
  subtotal: number;
  total: number;
}
export interface CartRepository {
  upsertLine(input: {
    customerId: string;
    conversationId: string;
    productId: string;
    variantId: string;
    sku: string;
    title: string;
    quantity: number;
    unitPrice: number;
    currency: string;
  }): Promise<Cart>;
  setLineQuantity(input: {
    customerId: string;
    conversationId: string;
    variantId: string;
    quantity: number;
  }): Promise<Cart>;
  removeLine(input: {
    customerId: string;
    conversationId: string;
    variantId: string;
  }): Promise<void>;
}
export interface CartService {
  add(input: unknown): Promise<Cart>;
  update(input: unknown): Promise<Cart>;
  remove(input: unknown): Promise<void>;
}

export function createCartService(input: {
  catalog: CatalogService;
  repository: CartRepository;
}): CartService {
  return {
    async add(value) {
      const mutation = CartMutationSchema.parse(value);
      const variant = await input.catalog.getVariant({
        variantId: mutation.variantId
      });
      if (
        !variant ||
        !variant.available ||
        variant.availableQuantity < mutation.quantity
      ) {
        throw new CheckoutConfirmationError('inventory_unavailable');
      }
      return input.repository.upsertLine({
        customerId: mutation.customerId,
        conversationId: mutation.conversationId,
        productId: variant.productId,
        variantId: variant.variantId,
        sku: variant.sku,
        title: variant.title,
        quantity: mutation.quantity,
        unitPrice: variant.price,
        currency: variant.currency
      });
    },
    async update(value) {
      const mutation = CartLineMutationSchema.parse(value);
      const variant = await input.catalog.getVariant({
        variantId: mutation.variantId
      });
      if (
        !variant ||
        !variant.available ||
        variant.availableQuantity < mutation.quantity
      )
        throw new CheckoutConfirmationError('inventory_unavailable');
      return input.repository.setLineQuantity(mutation);
    },
    async remove(value) {
      await input.repository.removeLine(RemoveCartLineSchema.parse(value));
    }
  };
}
