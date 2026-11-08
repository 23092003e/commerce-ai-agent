import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  PreparedCheckoutSnapshotSchema,
  CheckoutConfirmationError,
  verifyCheckoutConfirmation,
  type PreparedCheckoutConfirmation
} from './checkout.js';
import type { OrderService } from './order.js';

export interface ActiveCheckoutCart {
  id: string;
  version: number;
  currency: string;
  subtotal: number;
  total: number;
}
export interface ActiveCheckoutCartRepository {
  getActiveForConversation(
    conversationId: string
  ): Promise<ActiveCheckoutCart | null>;
}
export interface CheckoutConfirmationRepository {
  linkSummary(input: {
    conversationId: string;
    confirmationId: string;
    messageId: string;
    text: string;
  }): Promise<void>;
  prepare(input: {
    conversationId: string;
    confirmationSecret: string;
    preparedAt: number;
    expiresAt: number;
    nonce: string;
  }): Promise<PreparedCheckoutConfirmation>;
  getPrepared(
    conversationId: string
  ): Promise<PreparedCheckoutConfirmation | null>;
  invalidate(conversationId: string): Promise<void>;
}
export interface CheckoutOrderConfirmationService {
  linkSummary(input: {
    conversationId: string;
    confirmationId: string;
    messageId: string;
    text: string;
  }): Promise<void>;
  prepareConfirmation(
    conversationId: string
  ): Promise<PreparedCheckoutConfirmation>;
  getPrepared(
    conversationId: string
  ): Promise<PreparedCheckoutConfirmation | null>;
  confirmPrepared(input: {
    conversationId: string;
    confirmationId: string;
    confirmationMessageTimestamp: number;
  }): Promise<{ orderId: string; orderNumber: string; replayed?: boolean }>;
}
export function createCheckoutOrderConfirmationService(input: {
  confirmationSecret: string;
  confirmations: CheckoutConfirmationRepository;
  orders: OrderService;
  now?: () => number;
}): CheckoutOrderConfirmationService {
  const now = input.now ?? Date.now;
  return {
    linkSummary: (value) => input.confirmations.linkSummary(value),
    async prepareConfirmation(conversationId) {
      z.uuid().parse(conversationId);
      const preparedAt = now();
      return input.confirmations.prepare({
        conversationId,
        confirmationSecret: input.confirmationSecret,
        preparedAt,
        expiresAt: preparedAt + 900_000,
        nonce: randomUUID()
      });
    },
    getPrepared: (conversationId) =>
      input.confirmations.getPrepared(conversationId),
    async confirmPrepared(request) {
      const value = z
        .object({
          conversationId: z.uuid(),
          confirmationId: z.string().min(1),
          confirmationMessageTimestamp: z.number().int().nonnegative()
        })
        .strict()
        .parse(request);
      const prepared = await input.confirmations.getPrepared(
        value.conversationId
      );
      if (prepared?.confirmationId !== value.confirmationId)
        throw new CheckoutConfirmationError('confirmation_stale');
      const snapshot = PreparedCheckoutSnapshotSchema.parse(prepared.snapshot);
      if (
        snapshot.conversationId !== value.conversationId ||
        value.confirmationMessageTimestamp <= snapshot.preparedAt ||
        !verifyCheckoutConfirmation(
          input.confirmationSecret,
          snapshot,
          prepared.confirmationId
        )
      )
        throw new CheckoutConfirmationError('confirmation_stale');
      if (
        now() >= snapshot.expiresAt ||
        value.confirmationMessageTimestamp >= snapshot.expiresAt
      )
        throw new CheckoutConfirmationError('confirmation_expired');
      return input.orders.createConfirmed(
        prepared,
        value.confirmationMessageTimestamp
      );
    }
  };
}

export function renderPreparedCheckoutConfirmation(
  prepared: PreparedCheckoutConfirmation
): string {
  const snapshot = PreparedCheckoutSnapshotSchema.parse(prepared.snapshot);
  return [
    'Vui lòng xác nhận đơn hàng:',
    ...snapshot.lines.map(
      (line) =>
        `${line.productName} / ${line.variantName} (${line.sku}) x ${String(line.quantity)}: ${String(line.unitPrice)} ${snapshot.currency}/sản phẩm, thành tiền ${String(line.lineTotal)} ${snapshot.currency}`
    ),
    `Tạm tính: ${String(snapshot.subtotal)} ${snapshot.currency}`,
    `Phí giao hàng: ${String(snapshot.shippingFee)} ${snapshot.currency}`,
    `Giảm giá: ${String(snapshot.discountTotal)} ${snapshot.currency}`,
    `Tổng cộng: ${String(snapshot.total)} ${snapshot.currency}`,
    `Người nhận: ${snapshot.recipientName}; điện thoại: ${'*'.repeat(Math.max(0, snapshot.phone.length - 4))}${snapshot.phone.slice(-4)}`,
    `Địa chỉ: ${snapshot.address.line1}, ${snapshot.address.ward}, ${snapshot.address.city}`,
    `Thanh toán: ${snapshot.paymentMethod}`,
    'Anh/chị trả lời "xác nhận" để đặt đúng đơn hàng này. Bản tóm tắt có hiệu lực trong 15 phút.'
  ].join('\n');
}
