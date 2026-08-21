import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createCatalogService,
  createProductReferenceService
} from '@fanpage/domain';
import {
  PostgresCommerceRepository,
  PostgresCatalogRepository,
  PostgresProductReferenceStore,
  runMigrations
} from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresCatalogRepository(databaseUrl);
const commerceRepository = new PostgresCommerceRepository(databaseUrl);
const referenceStore = new PostgresProductReferenceStore(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const service = createCatalogService(repository);
const referenceService = createProductReferenceService(referenceStore);

beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});

afterAll(async () => {
  await repository.close();
  await commerceRepository.close();
  await referenceStore.close();
  await pool.end();
});

describe('Postgres catalog', () => {
  it('returns only DB-backed products matching translated filters', async () => {
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

    expect(result.products).toHaveLength(1);
    const product = result.products[0];
    if (!product) throw new Error('Expected matching catalog product');
    const { productId, ...projection } = product;
    expect(productId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(projection).toEqual({
      name: 'Essential Polo',
      slug: 'essential-polo',
      priceFrom: 449_000,
      currency: 'VND',
      availableColors: ['black'],
      availableSizes: ['L'],
      shortDescription: 'Áo polo demo tối giản cho trang phục hằng ngày.'
    });
  });

  it('ships the complete fake demo catalog seed', async () => {
    const counts = await pool.query<{
      products: string;
      variants: string;
      promotions: string;
      out_of_stock: string;
    }>(`
      SELECT
        (SELECT count(*) FROM products WHERE external_id LIKE 'demo-%') AS products,
        (SELECT count(*) FROM product_variants WHERE sku LIKE 'DEMO-%') AS variants,
        (SELECT count(*) FROM promotions WHERE name LIKE 'Demo %') AS promotions,
        (
          SELECT count(*)
          FROM inventory i
          JOIN product_variants v ON v.id = i.variant_id
          WHERE v.sku LIKE 'DEMO-%'
            AND GREATEST(i.quantity_available - i.quantity_reserved, 0) = 0
        ) AS out_of_stock
    `);

    expect(counts.rows[0]).toEqual({
      products: '20',
      variants: '40',
      promotions: '5',
      out_of_stock: '5'
    });
  });

  it('calculates available-to-sell from live inventory', async () => {
    const poloSearch = await service.searchProducts({
      query: 'polo',
      inStockOnly: false
    });
    const polo = poloSearch.products[0]
      ? await service.getProduct({
          productId: poloSearch.products[0].productId
        })
      : null;
    const availableVariant = polo?.variants.find(
      (variant) => variant.sku === 'DEMO-POLO-BLK-L'
    );
    if (!availableVariant) throw new Error('Expected available demo variant');

    await expect(
      service.checkInventory({ variantId: availableVariant.variantId })
    ).resolves.toEqual({
      variantId: availableVariant.variantId,
      sku: 'DEMO-POLO-BLK-L',
      available: true,
      availableQuantity: 6
    });

    const includingOutOfStock = await service.searchProducts({
      query: 'rain',
      inStockOnly: false
    });
    expect(includingOutOfStock.products[0]).toMatchObject({
      slug: 'rain-shell',
      availableColors: ['teal'],
      availableSizes: ['M']
    });
    const rainProduct = includingOutOfStock.products[0]
      ? await service.getProduct({
          productId: includingOutOfStock.products[0].productId
        })
      : null;
    const unavailableVariant = rainProduct?.variants.find(
      (variant) => variant.sku === 'DEMO-RAIN-BLK-L'
    );
    if (!unavailableVariant)
      throw new Error('Expected unavailable demo variant');
    await expect(
      service.checkInventory({ variantId: unavailableVariant.variantId })
    ).resolves.toEqual({
      variantId: unavailableVariant.variantId,
      sku: 'DEMO-RAIN-BLK-L',
      available: false,
      availableQuantity: 0
    });
  });

  it('persists product references with conversation version control', async () => {
    const suffix = randomUUID();
    const eventKey = `meta:message:catalog-reference-${suffix}`;
    await commerceRepository.storeWebhookEvent({
      externalEventKey: eventKey,
      metaPageId: `catalog-page-${suffix}`,
      conversationKey: `meta:catalog-page-${suffix}:catalog-customer-${suffix}`,
      eventTimestamp: Date.now(),
      rawPayload: { type: 'catalog-reference-test' }
    });
    await commerceRepository.markWebhookEventQueued(eventKey);
    await commerceRepository.persistInboundMessage({
      eventKey,
      metaPageId: `catalog-page-${suffix}`,
      metaPsid: `catalog-customer-${suffix}`,
      metaMessageId: `catalog-reference-${suffix}`,
      text: 'show me tops',
      timestamp: Date.now(),
      payload: { type: 'catalog-reference-test' }
    });
    const conversation =
      await commerceRepository.findOpenConversationByIdentity(
        `catalog-page-${suffix}`,
        `catalog-customer-${suffix}`
      );
    if (!conversation) throw new Error('Expected catalog conversation');

    const products = await service.searchProducts({
      categories: ['tops'],
      limit: 2
    });
    expect(products.products).toHaveLength(2);
    const turnId = randomUUID();
    const input = {
      conversationId: conversation.id,
      expectedVersion: conversation.version,
      turnId,
      items: products.products.map((product, index) => ({
        position: index + 1,
        productId: product.productId,
        variantId: null
      }))
    };

    const saved = await referenceService.saveProductReferences(input);
    expect(saved).toMatchObject({
      type: 'updated',
      version: conversation.version + 1,
      references: { turnId, items: input.items }
    });
    await expect(
      referenceService.saveProductReferences(input)
    ).resolves.toEqual({
      type: 'conflict',
      currentVersion: conversation.version + 1
    });
    if (saved.type !== 'updated') throw new Error('Expected saved references');
    expect(
      referenceService.resolveProductReference(saved.references, 2)
    ).toEqual(input.items[1]);
  });
});
