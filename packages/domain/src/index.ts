export {
  createDeterministicEmbeddingProvider,
  createKnowledgeService,
  KnowledgeIngestionSchema,
  KnowledgeSearchSchema,
  type EmbeddingProvider,
  type KnowledgeRepository,
  type KnowledgeSearchHit,
  type KnowledgeSearchResult,
  type KnowledgeService,
  type PreparedKnowledgeChunk,
  type PreparedKnowledgeDocument
} from './knowledge.js';
export {
  createCatalogService,
  InventoryCheckSchema,
  ProductLookupSchema,
  ProductSearchSchema,
  VariantLookupSchema,
  type CatalogProductDetailProjection,
  type CatalogProductProjection,
  type CatalogRepository,
  type CatalogService,
  type InventoryProjection,
  type ProductSearchFilters,
  type ProductVariantProjection
} from './catalog.js';
export {
  createProductReferenceService,
  SaveProductReferencesSchema,
  type ProductReferenceItem,
  type ProductReferences,
  type ProductReferenceService,
  type ProductReferenceStore,
  type SaveProductReferencesRepositoryInput,
  type SaveProductReferencesResult
} from './product-references.js';
