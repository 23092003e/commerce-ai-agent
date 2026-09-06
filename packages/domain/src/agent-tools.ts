import type { CatalogService } from './catalog.js';
import type { CartService } from './cart.js';
import type { CheckoutFlow } from './checkout-flow.js';
import type { KnowledgeService } from './knowledge.js';
import type { AgentTool } from './agent-orchestrator.js';

export function createReadOnlyAgentTools(input: {
  catalog: CatalogService;
  knowledge: KnowledgeService;
}): AgentTool[] {
  return [
    {
      name: 'knowledge.search',
      execute: (value) => input.knowledge.search(value)
    },
    {
      name: 'catalog.searchProducts',
      execute: (value) => input.catalog.searchProducts(value)
    },
    {
      name: 'catalog.getProduct',
      execute: (value) => input.catalog.getProduct(value)
    },
    {
      name: 'catalog.getVariant',
      execute: (value) => input.catalog.getVariant(value)
    },
    {
      name: 'catalog.checkInventory',
      execute: (value) => input.catalog.checkInventory(value)
    }
  ];
}

export function createCartAgentTools(input: {
  cart: CartService;
}): AgentTool[] {
  return [
    { name: 'cart.add', execute: (value) => input.cart.add(value) },
    { name: 'cart.update', execute: (value) => input.cart.update(value) },
    { name: 'cart.remove', execute: (value) => input.cart.remove(value) }
  ];
}

function scopedCheckoutInput(value: unknown, conversationId: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Checkout input must be an object');
  }
  return { ...value, conversationId };
}

export function createCheckoutAgentTools(input: {
  checkout: CheckoutFlow;
  conversationId: string;
}): AgentTool[] {
  return [
    {
      name: 'checkout.start',
      execute: () => input.checkout.start(input.conversationId)
    },
    {
      name: 'checkout.setRecipientName',
      execute: (value) =>
        input.checkout.setRecipientName(
          scopedCheckoutInput(value, input.conversationId)
        )
    },
    {
      name: 'checkout.setPhone',
      execute: (value) =>
        input.checkout.setPhone(
          scopedCheckoutInput(value, input.conversationId)
        )
    },
    {
      name: 'checkout.setAddress',
      execute: (value) =>
        input.checkout.setAddress(
          scopedCheckoutInput(value, input.conversationId)
        )
    },
    {
      name: 'checkout.setPaymentMethod',
      execute: (value) =>
        input.checkout.setPaymentMethod(
          scopedCheckoutInput(value, input.conversationId)
        )
    }
  ];
}
