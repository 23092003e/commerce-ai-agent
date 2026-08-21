import { describe, expect, it } from 'vitest';
import {
  createCatalogService,
  createProductReferenceService,
  type CatalogRepository,
  type ProductReferenceStore,
  type ProductSearchFilters,
  type SaveProductReferencesRepositoryInput
} from '../src/index.js';

function createRepository(
  overrides: Partial<CatalogRepository> = {}
): CatalogRepository {
  return {
    async searchProducts() {
      return [];
    },
    async getProduct() {
      return null;
    },
    async getVariant() {
      return null;
    },
    async checkInventory() {
      return null;
    },
    ...overrides
  };
}

describe('catalog service', () => {
  it('validates translated natural-language filters before searching', async () => {
    let capturedFilters: ProductSearchFilters | null = null;
    const repository = createRepository({
      async searchProducts(filters) {
        capturedFilters = filters;
        return [
          {
            productId: '11111111-1111-4111-8111-111111111111',
            name: 'Essential Polo',
            slug: 'essential-polo',
            priceFrom: 449_000,
            currency: 'VND',
            availableColors: ['black'],
            availableSizes: ['L'],
            shortDescription: 'Demo polo shirt'
          }
        ];
      }
    });
    const service = createCatalogService(repository);
    const naturalLanguageCase = {
      message: 'Tìm áo polo màu đen size L dưới 500k',
      translatedFilters: {
        query: 'polo',
        categories: ['tops'],
        colors: ['black'],
        sizes: ['L'],
        maxPrice: 500_000
      }
    };

    const result = await service.searchProducts(
      naturalLanguageCase.translatedFilters
    );

    expect(capturedFilters).toEqual({
      query: 'polo',
      categories: ['tops'],
      colors: ['black'],
      sizes: ['L'],
      maxPrice: 500_000,
      inStockOnly: true,
      limit: 5
    });
    expect(result.products).toEqual([
      expect.objectContaining({
        name: 'Essential Polo',
        priceFrom: 449_000,
        availableColors: ['black'],
        availableSizes: ['L']
      })
    ]);
  });

  it('rejects unrecognized query controls before repository execution', async () => {
    let repositoryCalls = 0;
    const repository = createRepository({
      async searchProducts() {
        repositoryCalls += 1;
        return [];
      }
    });
    const service = createCatalogService(repository);

    await expect(
      service.searchProducts({ query: 'polo', rawSql: 'DROP TABLE products' })
    ).rejects.toThrow();
    expect(repositoryCalls).toBe(0);
  });

  it('returns database-backed available-to-sell inventory', async () => {
    const variantId = '22222222-2222-4222-8222-222222222222';
    const repository = createRepository({
      async checkInventory(requestedVariantId: string) {
        expect(requestedVariantId).toBe(variantId);
        return {
          variantId,
          sku: 'POLO-BLK-L',
          available: true,
          availableQuantity: 2
        };
      }
    });
    const service = createCatalogService(repository);

    await expect(service.checkInventory({ variantId })).resolves.toEqual({
      variantId,
      sku: 'POLO-BLK-L',
      available: true,
      availableQuantity: 2
    });
  });

  it('resolves a searched product to typed variants before stock check', async () => {
    const productId = '77777777-7777-4777-8777-777777777777';
    const variantId = '88888888-8888-4888-8888-888888888888';
    const repository = createRepository({
      async getProduct(requestedProductId: string) {
        expect(requestedProductId).toBe(productId);
        return {
          productId,
          name: 'Essential Polo',
          slug: 'essential-polo',
          priceFrom: 449_000,
          currency: 'VND',
          availableColors: ['black'],
          availableSizes: ['L'],
          shortDescription: 'Demo polo shirt',
          variants: [
            {
              variantId,
              productId,
              sku: 'POLO-BLK-L',
              title: 'Black / L',
              color: 'black',
              size: 'L',
              price: 449_000,
              currency: 'VND',
              available: true,
              availableQuantity: 2
            }
          ]
        };
      }
    });
    const service = createCatalogService(repository);

    const product = await service.getProduct({ productId });

    expect(product?.variants).toEqual([
      expect.objectContaining({
        variantId,
        color: 'black',
        size: 'L',
        availableQuantity: 2
      })
    ]);
  });

  it('persists ordered product references and resolves a position', async () => {
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const firstProductId = '44444444-4444-4444-8444-444444444444';
    const secondProductId = '55555555-5555-4555-8555-555555555555';
    const turnId = '66666666-6666-4666-8666-666666666666';
    const store: ProductReferenceStore = {
      async saveProductReferences(input: SaveProductReferencesRepositoryInput) {
        return {
          type: 'updated' as const,
          version: 8,
          references: input.references
        };
      }
    };
    const service = createProductReferenceService(store);

    const saved = await service.saveProductReferences({
      conversationId,
      expectedVersion: 7,
      turnId,
      items: [
        { position: 2, productId: secondProductId, variantId: null },
        { position: 1, productId: firstProductId, variantId: null }
      ]
    });

    expect(saved).toMatchObject({
      type: 'updated',
      version: 8,
      references: {
        turnId,
        items: [
          { position: 1, productId: firstProductId, variantId: null },
          { position: 2, productId: secondProductId, variantId: null }
        ]
      }
    });
    if (saved.type !== 'updated') throw new Error('Expected updated result');
    expect(service.resolveProductReference(saved.references, 2)).toEqual({
      position: 2,
      productId: secondProductId,
      variantId: null
    });
  });
});
