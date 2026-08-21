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
