import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CheckoutSnapshotSchema = z
  .object({
    cartId: z.uuid(),
    cartVersion: z.number().int().positive(),
    recipientName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(6).max(32),
    address: z
      .object({
        line1: z.string().trim().min(1).max(200),
        ward: z.string().trim().min(1).max(100),
        city: z.string().trim().min(1).max(100)
      })
      .strict(),
    paymentMethod: z.enum(['cod', 'bank_transfer', 'other']),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    subtotal: money,
    shippingFee: money,
    discountTotal: money,
    total: money
  })
  .strict()
  .refine(
    (value) =>
      value.total === value.subtotal + value.shippingFee - value.discountTotal,
    { message: 'Checkout total does not match snapshot' }
  );
export type CheckoutSnapshot = z.infer<typeof CheckoutSnapshotSchema>;
function serialize(snapshot: CheckoutSnapshot): string {
  return JSON.stringify(snapshot);
}
export function createCheckoutConfirmation(
  secret: string,
  input: unknown
): { confirmationId: string; snapshot: CheckoutSnapshot } {
  if (secret.length < 32)
    throw new Error(
      'Checkout confirmation secret must be at least 32 characters'
    );
  const snapshot = CheckoutSnapshotSchema.parse(input);
  return {
    snapshot,
    confirmationId: createHmac('sha256', secret)
      .update(serialize(snapshot))
      .digest('base64url')
  };
}
export function verifyCheckoutConfirmation(
  secret: string,
  input: unknown,
  confirmationId: string
): boolean {
  const expected = createCheckoutConfirmation(secret, input).confirmationId;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(confirmationId);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
