import {
  createCheckoutConfirmation,
  type CheckoutSnapshot
} from './checkout.js';
import type {
  CheckoutDraft,
  CheckoutDraftRepository
} from './checkout-flow.js';
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

export interface CheckoutOrderConfirmationService {
  isReady(conversationId: string): Promise<boolean>;
  confirm(
    conversationId: string
  ): Promise<{ orderId: string; orderNumber: string }>;
}

function snapshotFor(
  draft: CheckoutDraft,
  cart: ActiveCheckoutCart
): CheckoutSnapshot {
  if (
    draft.state !== 'awaiting_confirmation' ||
    !draft.recipientName ||
    !draft.phone ||
    !draft.address ||
    !draft.paymentMethod
  ) {
    throw new Error('Checkout is not ready for confirmation');
  }
  return {
    cartId: cart.id,
    cartVersion: cart.version,
    recipientName: draft.recipientName,
    phone: draft.phone,
    address: draft.address,
    paymentMethod: draft.paymentMethod,
    currency: cart.currency,
    subtotal: cart.subtotal,
    shippingFee: 0,
    discountTotal: 0,
    total: cart.total
  };
}

export function createCheckoutOrderConfirmationService(input: {
  confirmationSecret: string;
  checkout: CheckoutDraftRepository;
  carts: ActiveCheckoutCartRepository;
  orders: OrderService;
}): CheckoutOrderConfirmationService {
  return {
    async isReady(conversationId) {
      const draft = await input.checkout.get(conversationId);
      if (!draft) return false;
      const cart = await input.carts.getActiveForConversation(conversationId);
      try {
        return cart !== null && snapshotFor(draft, cart).total >= 0;
      } catch {
        return false;
      }
    },
    async confirm(conversationId) {
      const draft = await input.checkout.get(conversationId);
      if (!draft) throw new Error('Checkout conversation was not found');
      const cart = await input.carts.getActiveForConversation(conversationId);
      if (!cart) throw new Error('Active checkout cart was not found');
      const confirmation = createCheckoutConfirmation(
        input.confirmationSecret,
        snapshotFor(draft, cart)
      );
      return input.orders.createConfirmed(confirmation);
    }
  };
}
