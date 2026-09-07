import { z } from 'zod';
import {
  CheckoutSnapshotSchema,
  type CheckoutSnapshot,
  verifyCheckoutConfirmation
} from './checkout.js';

const CreateConfirmedOrderSchema = z
  .object({
    confirmationId: z.string().min(1).max(200),
    snapshot: CheckoutSnapshotSchema
  })
  .strict();
export interface ConfirmedOrderRepository {
  createConfirmed(
    snapshot: CheckoutSnapshot,
    confirmationId: string
  ): Promise<{ orderId: string; orderNumber: string }>;
}
export interface OrderService {
  createConfirmed(
    input: unknown
  ): Promise<{ orderId: string; orderNumber: string }>;
}
export function createOrderService(input: {
  confirmationSecret: string;
  repository: ConfirmedOrderRepository;
}): OrderService {
  return {
    async createConfirmed(value) {
      const request = CreateConfirmedOrderSchema.parse(value);
      if (
        !verifyCheckoutConfirmation(
          input.confirmationSecret,
          request.snapshot,
          request.confirmationId
        )
      ) {
        throw new Error('Checkout confirmation is invalid or stale');
      }
      return input.repository.createConfirmed(
        request.snapshot,
        request.confirmationId
      );
    }
  };
}
