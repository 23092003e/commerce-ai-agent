import type { CatalogService } from './catalog.js';
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
