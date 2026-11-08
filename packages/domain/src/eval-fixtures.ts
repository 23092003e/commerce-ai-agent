import { createCatalogService } from './catalog.js';
import { createCartService } from './cart.js';
import { createCheckoutFlow, type CheckoutDraft } from './checkout-flow.js';
import { createCheckoutOrderConfirmationService } from './checkout-order.js';
import {
  createPreparedCheckoutConfirmation,
  type PreparedCheckoutConfirmation
} from './checkout.js';
import { createOrderService } from './order.js';
import {
  createReadOnlyAgentTools,
  createScopedCartAgentTools,
  createCheckoutAgentTools
} from './agent-tools.js';
import type { AgentTool } from './agent-orchestrator.js';
import { KnowledgeSearchSchema } from './knowledge.js';

export const EVAL_IDS = {
  customer: '11111111-1111-4111-8111-111111111111',
  conversation: '22222222-2222-4222-8222-222222222222',
  product: '33333333-3333-4333-8333-333333333333',
  variant: '44444444-4444-4444-8444-444444444444',
  cart: '55555555-5555-4555-8555-555555555555',
  chunk: '66666666-6666-4666-8666-666666666666',
  document: '77777777-7777-4777-8777-777777777777',
  other: '88888888-8888-4888-8888-888888888888',
  order: '99999999-9999-4999-8999-999999999999'
} as const;
export const EVAL_NOW = 1_800_000_000_000;
const secret = 'offline-evaluation-confirmation-secret-at-least-32';
export const EVAL_PRODUCT = {
  productId: EVAL_IDS.product,
  name: 'Essential Polo',
  slug: 'essential-polo',
  priceFrom: 120000,
  currency: 'VND',
  availableColors: ['black'],
  availableSizes: ['M'],
  shortDescription: 'Cotton polo'
};
export const EVAL_VARIANT = {
  productId: EVAL_IDS.product,
  variantId: EVAL_IDS.variant,
  sku: 'POLO-M',
  title: 'Black / M',
  color: 'black',
  size: 'M',
  price: 120000,
  currency: 'VND',
  available: true,
  availableQuantity: 10
};

export interface EvalState {
  cartQuantity: number;
  cartTotal: number;
  cartVersion: number;
  checkoutState: CheckoutDraft['state'];
  checkoutVersion: number;
  orderCount: number;
  reservedQuantity: number;
  preparedConfirmationId: string | null;
  lastConfirmationError: string | null;
}
export const EMPTY_EVAL_STATE: EvalState = {
  cartQuantity: 0,
  cartTotal: 0,
  cartVersion: 1,
  checkoutState: 'none',
  checkoutVersion: 1,
  orderCount: 0,
  reservedQuantity: 0,
  preparedConfirmationId: null,
  lastConfirmationError: null
};
export interface EvalToolFixtures {
  stock: number;
  knowledge: 'approved' | 'none' | 'archived';
  failTools: AgentTool['name'][];
  unavailableProduct: boolean;
}
export const DEFAULT_EVAL_FIXTURES: EvalToolFixtures = {
  stock: 10,
  knowledge: 'approved',
  failTools: [],
  unavailableProduct: false
};

export function createEvalHarness(
  initial: EvalState,
  fixtures: EvalToolFixtures
) {
  const state = structuredClone(initial);
  const draft: CheckoutDraft = {
    conversationId: EVAL_IDS.conversation,
    version: state.checkoutVersion,
    state: state.checkoutState,
    recipientName:
      state.checkoutState === 'awaiting_confirmation' ? 'Lan' : null,
    phone:
      state.checkoutState === 'awaiting_confirmation' ? '0900000000' : null,
    address:
      state.checkoutState === 'awaiting_confirmation'
        ? { line1: '1 Main', ward: 'Ward', city: 'HCM' }
        : null,
    paymentMethod:
      state.checkoutState === 'awaiting_confirmation' ? 'cod' : null
  };
  let prepared: PreparedCheckoutConfirmation | null = null;
  let clock = EVAL_NOW;
  const invalidate = () => {
    prepared = null;
    state.preparedConfirmationId = null;
  };
  const cartValue = () => ({
    id: EVAL_IDS.cart,
    currency: 'VND',
    lines: state.cartQuantity
      ? [
          {
            productId: EVAL_IDS.product,
            variantId: EVAL_IDS.variant,
            sku: EVAL_VARIANT.sku,
            title: EVAL_VARIANT.title,
            quantity: state.cartQuantity,
            unitPrice: 120000,
            lineTotal: state.cartTotal
          }
        ]
      : [],
    subtotal: state.cartTotal,
    total: state.cartTotal
  });
  const scope = (input: { customerId: string; conversationId: string }) => {
    if (
      input.customerId !== EVAL_IDS.customer ||
      input.conversationId !== EVAL_IDS.conversation
    )
      throw new Error('cart_scope_mismatch');
  };
  const mutate = (quantity: number) => {
    state.cartQuantity = quantity;
    state.cartTotal = quantity * 120000;
    state.cartVersion++;
    invalidate();
    return cartValue();
  };
  const catalog = createCatalogService({
    async searchProducts(filters) {
      return fixtures.unavailableProduct ||
        (filters.maxPrice !== undefined && filters.maxPrice < 120000)
        ? []
        : [EVAL_PRODUCT];
    },
    async getProduct(id) {
      return id === EVAL_IDS.product && !fixtures.unavailableProduct
        ? {
            ...EVAL_PRODUCT,
            variants: [
              {
                ...EVAL_VARIANT,
                availableQuantity: fixtures.stock,
                available: fixtures.stock > 0
              }
            ]
          }
        : null;
    },
    async getVariant(id) {
      return id === EVAL_IDS.variant && !fixtures.unavailableProduct
        ? {
            ...EVAL_VARIANT,
            availableQuantity: fixtures.stock,
            available: fixtures.stock > 0
          }
        : null;
    },
    async checkInventory(id) {
      return id === EVAL_IDS.variant
        ? {
            variantId: id,
            sku: EVAL_VARIANT.sku,
            available: fixtures.stock > 0,
            availableQuantity: fixtures.stock
          }
        : null;
    }
  });
  const cart = createCartService({
    catalog,
    repository: {
      async upsertLine(input) {
        scope(input);
        return mutate(input.quantity);
      },
      async setLineQuantity(input) {
        scope(input);
        if (!state.cartQuantity) throw new Error('cart_empty');
        return mutate(input.quantity);
      },
      async removeLine(input) {
        scope(input);
        if (!state.cartQuantity) throw new Error('cart_empty');
        mutate(0);
      }
    }
  });
  const checkout = createCheckoutFlow({
    async get() {
      return structuredClone(draft);
    },
    async update(input) {
      if (input.expectedVersion !== draft.version)
        throw new Error('Checkout version conflict');
      draft.state = input.state;
      draft.version++;
      if (input.recipientName !== undefined)
        draft.recipientName = input.recipientName;
      if (input.phone !== undefined) draft.phone = input.phone;
      if (input.address !== undefined) draft.address = input.address;
      if (input.paymentMethod !== undefined)
        draft.paymentMethod = input.paymentMethod;
      state.checkoutState = draft.state;
      state.checkoutVersion = draft.version;
      invalidate();
      return structuredClone(draft);
    }
  });
  const confirmed = new Map<string, { orderId: string; orderNumber: string }>();
  const orders = createOrderService({
    confirmationSecret: secret,
    repository: {
      async createConfirmed(snapshot, id) {
        const existing = confirmed.get(id);
        if (existing) return existing;
        if (
          id !== prepared?.confirmationId ||
          snapshot.cartVersion !== state.cartVersion
        )
          throw new Error('confirmation_stale');
        if (clock >= snapshot.expiresAt)
          throw new Error('confirmation_expired');
        if (fixtures.stock < state.cartQuantity)
          throw new Error('inventory_unavailable');
        state.orderCount++;
        state.reservedQuantity += state.cartQuantity;
        state.checkoutState = 'none';
        state.checkoutVersion++;
        draft.state = 'none';
        draft.version = state.checkoutVersion;
        const result = { orderId: EVAL_IDS.order, orderNumber: 'ORD-EVAL' };
        confirmed.set(id, result);
        return result;
      }
    }
  });
  const confirmation = createCheckoutOrderConfirmationService({
    confirmationSecret: secret,
    orders,
    now: () => clock,
    confirmations: {
      async prepare(input) {
        if (
          draft.state !== 'awaiting_confirmation' ||
          !draft.recipientName ||
          !draft.phone ||
          !draft.address ||
          !draft.paymentMethod ||
          !state.cartQuantity
        )
          throw new Error('checkout_incomplete');
        prepared = createPreparedCheckoutConfirmation(secret, {
          currency: 'VND',
          subtotal: state.cartTotal,
          total: state.cartTotal,
          cartId: EVAL_IDS.cart,
          cartVersion: state.cartVersion,
          recipientName: draft.recipientName,
          phone: draft.phone,
          address: draft.address,
          paymentMethod: draft.paymentMethod,
          conversationId: EVAL_IDS.conversation,
          nonce: 'offline-fixture-nonce',
          preparedAt: input.preparedAt,
          expiresAt: input.expiresAt,
          shippingFee: 0,
          discountTotal: 0,
          lines: [
            {
              productId: EVAL_IDS.product,
              variantId: EVAL_IDS.variant,
              sku: EVAL_VARIANT.sku,
              productName: EVAL_PRODUCT.name,
              variantName: EVAL_VARIANT.title,
              quantity: state.cartQuantity,
              unitPrice: 120000,
              lineTotal: state.cartTotal
            }
          ]
        });
        state.preparedConfirmationId = prepared.confirmationId;
        return structuredClone(prepared);
      },
      async getPrepared() {
        return structuredClone(prepared);
      },
      async linkSummary() {},
      async invalidate() {
        invalidate();
      }
    }
  });
  const tools = [
    ...createReadOnlyAgentTools({
      catalog,
      knowledge: {
        async ingest() {
          throw new Error('not_authorized');
        },
        async search(input) {
          KnowledgeSearchSchema.parse(input);
          return fixtures.knowledge === 'none'
            ? { type: 'insufficient_evidence' as const, chunks: [] }
            : {
                type: 'evidence' as const,
                chunks: [
                  {
                    chunkId: EVAL_IDS.chunk,
                    documentId: EVAL_IDS.document,
                    content:
                      'Approved returns policy: contact support within seven days.',
                    section: null,
                    combinedScore: 1,
                    ...(fixtures.knowledge === 'archived'
                      ? { status: 'archived' }
                      : {})
                  }
                ]
              };
        }
      }
    }),
    ...createScopedCartAgentTools({
      cart,
      customerId: EVAL_IDS.customer,
      conversationId: EVAL_IDS.conversation
    }),
    ...createCheckoutAgentTools({
      checkout,
      conversationId: EVAL_IDS.conversation,
      confirmation
    })
  ].map((tool): AgentTool => ({
    ...tool,
    execute: async (input) => {
      if (fixtures.failTools.includes(tool.name))
        throw new Error('injected_tool_failure');
      return tool.execute(input);
    }
  }));
  return {
    state,
    tools,
    async after(
      action: 'confirm' | 'stale_confirm' | 'expired_confirm' | 'replay_confirm'
    ) {
      if (!prepared) {
        state.lastConfirmationError = 'confirmation_stale';
        return;
      }
      const id = prepared.confirmationId;
      if (action === 'stale_confirm') state.cartVersion++;
      clock = action === 'expired_confirm' ? EVAL_NOW + 900000 : EVAL_NOW + 1;
      try {
        await confirmation.confirmPrepared({
          conversationId: EVAL_IDS.conversation,
          confirmationId: id,
          confirmationMessageTimestamp: EVAL_NOW + 1
        });
        if (action === 'replay_confirm')
          await confirmation.confirmPrepared({
            conversationId: EVAL_IDS.conversation,
            confirmationId: id,
            confirmationMessageTimestamp: EVAL_NOW + 1
          });
      } catch (error) {
        state.lastConfirmationError =
          error instanceof Error ? error.message : 'unknown';
      }
    }
  };
}
