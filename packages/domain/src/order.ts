import { z } from 'zod';
import {
  PreparedCheckoutSnapshotSchema,
  type PreparedCheckoutSnapshot,
  verifyCheckoutConfirmation
} from './checkout.js';

const CreateConfirmedOrderSchema = z
  .object({
    confirmationId: z.string().min(1).max(200),
    snapshot: PreparedCheckoutSnapshotSchema
  })
  .strict();
export interface ConfirmedOrderRepository {
  createConfirmed(
    snapshot: PreparedCheckoutSnapshot,
    confirmationId: string,
    confirmationMessageTimestamp: number
  ): Promise<{ orderId: string; orderNumber: string; replayed?: boolean }>;
}
export interface OrderService {
  createConfirmed(
    input: unknown,
    confirmationMessageTimestamp: number
  ): Promise<{ orderId: string; orderNumber: string; replayed?: boolean }>;
}
export function createOrderService(input: {
  confirmationSecret: string;
  repository: ConfirmedOrderRepository;
}): OrderService {
  return {
    async createConfirmed(value, confirmationMessageTimestamp) {
      z.number().int().nonnegative().parse(confirmationMessageTimestamp);
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
        request.confirmationId,
        confirmationMessageTimestamp
      );
    }
  };
}
