import { z } from 'zod';

const normalizedFilterValues = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(10);
const projectedFilterValues = z.array(z.string().min(1).max(100)).max(50);
const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currencySchema = z.string().regex(/^[A-Z]{3}$/u);
const safeHttpUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'Only HTTP(S) image URLs are allowed'
  });

export const ProductSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    categories: normalizedFilterValues.optional(),
    brands: normalizedFilterValues.optional(),
    colors: normalizedFilterValues.optional(),
    sizes: normalizedFilterValues.optional(),
    minPrice: moneySchema.optional(),
    maxPrice: moneySchema.optional(),
    inStockOnly: z.boolean().default(true),
    limit: z.number().int().min(1).max(10).default(5)
  })
  .strict()
  .refine(
    (filters) =>
      filters.minPrice === undefined ||
      filters.maxPrice === undefined ||
      filters.minPrice <= filters.maxPrice,
    { message: 'minPrice must not exceed maxPrice', path: ['minPrice'] }
  );

export const ProductLookupSchema = z.object({ productId: z.uuid() }).strict();
export const VariantLookupSchema = z.object({ variantId: z.uuid() }).strict();
export const InventoryCheckSchema = VariantLookupSchema;

const CatalogProductProjectionSchema = z
  .object({
    productId: z.uuid(),
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(200),
    priceFrom: moneySchema,
    currency: currencySchema,
    availableColors: projectedFilterValues,
    availableSizes: projectedFilterValues,
    shortDescription: z.string().max(500),
    imageUrl: safeHttpUrlSchema.optional()
  })
  .strict();

const ProductVariantProjectionSchema = z
  .object({
    variantId: z.uuid(),
    productId: z.uuid(),
    sku: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    color: z.string().min(1).max(100).nullable(),
    size: z.string().min(1).max(100).nullable(),
    price: moneySchema,
    currency: currencySchema,
    available: z.boolean(),
    availableQuantity: z.number().int().nonnegative()
  })
  .strict();

const CatalogProductDetailProjectionSchema =
  CatalogProductProjectionSchema.extend({
    variants: z.array(ProductVariantProjectionSchema).max(100)
  });

const InventoryProjectionSchema = z
  .object({
    variantId: z.uuid(),
    sku: z.string().min(1).max(100),
    available: z.boolean(),
    availableQuantity: z.number().int().nonnegative()
  })
  .strict();

export type ProductSearchFilters = z.infer<typeof ProductSearchSchema>;
export type CatalogProductProjection = z.infer<
  typeof CatalogProductProjectionSchema
>;
export type ProductVariantProjection = z.infer<
  typeof ProductVariantProjectionSchema
>;
export type CatalogProductDetailProjection = z.infer<
  typeof CatalogProductDetailProjectionSchema
>;
export type InventoryProjection = z.infer<typeof InventoryProjectionSchema>;

export interface CatalogRepository {
  searchProducts(
    filters: ProductSearchFilters
  ): Promise<CatalogProductProjection[]>;
  getProduct(productId: string): Promise<CatalogProductDetailProjection | null>;
  getVariant(variantId: string): Promise<ProductVariantProjection | null>;
  checkInventory(variantId: string): Promise<InventoryProjection | null>;
}

export interface CatalogService {
  searchProducts(input: unknown): Promise<{
    products: CatalogProductProjection[];
  }>;
  getProduct(input: unknown): Promise<CatalogProductDetailProjection | null>;
  getVariant(input: unknown): Promise<ProductVariantProjection | null>;
  checkInventory(input: unknown): Promise<InventoryProjection | null>;
}

export function createCatalogService(
  repository: CatalogRepository
): CatalogService {
  return {
    async searchProducts(input) {
      const filters = ProductSearchSchema.parse(input);
      const products = await repository.searchProducts(filters);
      return {
        products: products.map((product) =>
          CatalogProductProjectionSchema.parse(product)
        )
      };
    },
    async getProduct(input) {
      const { productId } = ProductLookupSchema.parse(input);
      const product = await repository.getProduct(productId);
      return product
        ? CatalogProductDetailProjectionSchema.parse(product)
        : null;
    },
    async getVariant(input) {
      const { variantId } = VariantLookupSchema.parse(input);
      const variant = await repository.getVariant(variantId);
      return variant ? ProductVariantProjectionSchema.parse(variant) : null;
    },
    async checkInventory(input) {
      const { variantId } = InventoryCheckSchema.parse(input);
      const inventory = await repository.checkInventory(variantId);
      return inventory ? InventoryProjectionSchema.parse(inventory) : null;
    }
  };
}
