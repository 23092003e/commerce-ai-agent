import type { CatalogService } from './catalog.js';
import type { CartService } from './cart.js';
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
