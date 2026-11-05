import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export type CheckoutConfirmationErrorCode =
  | 'confirmation_stale'
  | 'confirmation_expired'
  | 'confirmation_consumed'
  | 'inventory_unavailable';
export class CheckoutConfirmationError extends Error {
  constructor(readonly code: CheckoutConfirmationErrorCode) {
    super(code);
    this.name = 'CheckoutConfirmationError';
  }
}

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CheckoutConfirmationLineSchema = z
  .object({
    productId: z.uuid(),
    variantId: z.uuid(),
    sku: z.string().min(1),
    productName: z.string().min(1),
    variantName: z.string().min(1),
    quantity: z.number().int().min(1).max(99),
    unitPrice: money,
    lineTotal: money
  })
  .strict()
  .refine(
    (line) =>
      Number.isSafeInteger(line.unitPrice * line.quantity) &&
      line.lineTotal === line.unitPrice * line.quantity,
    { message: 'Invalid confirmation line total' }
  );
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
    total: money,
    conversationId: z.uuid().optional(),
    nonce: z.string().min(1).optional(),
    preparedAt: z.number().int().nonnegative().optional(),
    expiresAt: z.number().int().positive().optional(),
    lines: z.array(CheckoutConfirmationLineSchema).min(1).optional()
  })
  .strict()
  .refine(
    (value) =>
      value.total === value.subtotal + value.shippingFee - value.discountTotal,
    { message: 'Checkout total does not match snapshot' }
  );
export type CheckoutSnapshot = z.infer<typeof CheckoutSnapshotSchema>;
export const PreparedCheckoutSnapshotSchema = CheckoutSnapshotSchema.safeExtend(
  {
    conversationId: z.uuid(),
    nonce: z.string().min(1),
    preparedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    lines: z.array(CheckoutConfirmationLineSchema).min(1)
  }
)
  .refine(
    (value) =>
      value.expiresAt > value.preparedAt &&
      value.expiresAt - value.preparedAt <= 900_000,
    { message: 'Invalid confirmation lifetime' }
  )
  .refine(
    (value) =>
      value.lines.reduce((sum, line) => sum + line.lineTotal, 0) ===
      value.subtotal,
    { message: 'Confirmation lines do not match subtotal' }
  );
export type PreparedCheckoutSnapshot = z.infer<
  typeof PreparedCheckoutSnapshotSchema
>;
export interface PreparedCheckoutConfirmation {
  confirmationId: string;
  snapshot: PreparedCheckoutSnapshot;
}
export function createPreparedCheckoutConfirmation(
  secret: string,
  value: unknown
): PreparedCheckoutConfirmation {
  const snapshot = PreparedCheckoutSnapshotSchema.parse(value);
  return {
    confirmationId: createCheckoutConfirmation(secret, snapshot).confirmationId,
    snapshot
  };
}
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
