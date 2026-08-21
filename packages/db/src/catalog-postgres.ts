import type {
  CatalogProductDetailProjection,
  CatalogProductProjection,
  CatalogRepository,
  InventoryProjection,
  ProductSearchFilters,
  ProductVariantProjection
} from '@fanpage/domain';
import { and, asc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

interface VariantRow {
  variantId: string;
  productId: string;
  sku: string;
  title: string;
  color: string | null;
  size: string | null;
  price: number;
  currency: string;
  availableQuantity: number;
}

function lowerValues(values: string[]): string[] {
  return values.map((value) => value.toLocaleLowerCase('en-US'));
}

function lowerIn(column: SQLWrapper, values: string[]): SQL {
  const parameters = lowerValues(values).map((value) => sql`${value}`);
  return sql`lower(${column}) IN (${sql.join(parameters, sql`, `)})`;
}

function safeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Catalog money or quantity is outside the safe range');
  }
  return parsed;
}

function optionalImageUrl(attributes: unknown): string | undefined {
  if (attributes === null || typeof attributes !== 'object') return undefined;
  const imageUrl = (attributes as Record<string, unknown>).imageUrl;
  if (typeof imageUrl !== 'string' || imageUrl.length > 2_048) return undefined;
  try {
    const parsed = new URL(imageUrl);
    return ['http:', 'https:'].includes(parsed.protocol) ? imageUrl : undefined;
  } catch {
    return undefined;
  }
}

export class PostgresCatalogRepository implements CatalogRepository {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool, { schema });
  }

  async searchProducts(
    filters: ProductSearchFilters
  ): Promise<CatalogProductProjection[]> {
    const predicates: SQL[] = [
      eq(schema.products.status, 'active'),
      eq(schema.productVariants.status, 'active')
    ];
    if (filters.query) {
      predicates.push(
        sql`to_tsvector('simple', ${schema.products.searchText}) @@ plainto_tsquery('simple', ${filters.query})`
      );
    }
    if (filters.categories) {
      predicates.push(
        lowerIn(schema.productCategories.slug, filters.categories)
      );
    }
    if (filters.brands) {
      predicates.push(lowerIn(schema.products.brand, filters.brands));
    }
    if (filters.colors) {
      predicates.push(lowerIn(schema.productVariants.color, filters.colors));
    }
    if (filters.sizes) {
      predicates.push(lowerIn(schema.productVariants.size, filters.sizes));
    }
    if (filters.minPrice !== undefined) {
      predicates.push(
        sql`${schema.productVariants.price} >= ${filters.minPrice}`
      );
    }
    if (filters.maxPrice !== undefined) {
      predicates.push(
        sql`${schema.productVariants.price} <= ${filters.maxPrice}`
      );
    }
    if (filters.inStockOnly) {
      predicates.push(
        sql`GREATEST(${schema.inventory.quantityAvailable} - ${schema.inventory.quantityReserved}, 0) > 0`
      );
    }

    const rows = await this.db
      .select({
        productId: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        priceFrom: sql<number>`MIN(${schema.productVariants.price})`.mapWith(
          safeInteger
        ),
        currency: schema.products.currency,
        availableColors: sql<
          string[]
        >`COALESCE(array_agg(DISTINCT ${schema.productVariants.color} ORDER BY ${schema.productVariants.color}) FILTER (
          WHERE ${schema.productVariants.color} IS NOT NULL
            AND GREATEST(${schema.inventory.quantityAvailable} - ${schema.inventory.quantityReserved}, 0) > 0
        ), '{}')`,
        availableSizes: sql<
          string[]
        >`COALESCE(array_agg(DISTINCT ${schema.productVariants.size} ORDER BY ${schema.productVariants.size}) FILTER (
          WHERE ${schema.productVariants.size} IS NOT NULL
            AND GREATEST(${schema.inventory.quantityAvailable} - ${schema.inventory.quantityReserved}, 0) > 0
        ), '{}')`,
        shortDescription: sql<string>`LEFT(${schema.products.description}, 500)`,
        attributes: schema.products.attributes
      })
      .from(schema.products)
      .innerJoin(
        schema.productCategories,
        eq(schema.products.categoryId, schema.productCategories.id)
      )
      .innerJoin(
        schema.productVariants,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .innerJoin(
        schema.inventory,
        eq(schema.inventory.variantId, schema.productVariants.id)
      )
      .where(and(...predicates))
      .groupBy(
        schema.products.id,
        schema.products.name,
        schema.products.slug,
        schema.products.currency,
        schema.products.description,
        schema.products.attributes
      )
      .orderBy(
        sql`MIN(${schema.productVariants.price})`,
        asc(schema.products.name)
      )
      .limit(filters.limit);

    return rows.map(({ attributes, ...row }) => {
      const imageUrl = optionalImageUrl(attributes);
      return imageUrl ? { ...row, imageUrl } : row;
    });
  }

  async getProduct(
    productId: string
  ): Promise<CatalogProductDetailProjection | null> {
    const [product] = await this.db
      .select({
        productId: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        currency: schema.products.currency,
        shortDescription: sql<string>`LEFT(${schema.products.description}, 500)`,
        attributes: schema.products.attributes
      })
      .from(schema.products)
      .where(
        and(
          eq(schema.products.id, productId),
          eq(schema.products.status, 'active')
        )
      )
      .limit(1);
    if (!product) return null;

    const variants = await this.findActiveVariants(productId);
    if (variants.length === 0) return null;
    const availableVariants = variants.filter((variant) => variant.available);
    const imageUrl = optionalImageUrl(product.attributes);
    const projection = {
      productId: product.productId,
      name: product.name,
      slug: product.slug,
      priceFrom: Math.min(...variants.map((variant) => variant.price)),
      currency: product.currency,
      availableColors: [
        ...new Set(
          availableVariants.flatMap((variant) =>
            variant.color ? [variant.color] : []
          )
        )
      ].sort(),
      availableSizes: [
        ...new Set(
          availableVariants.flatMap((variant) =>
            variant.size ? [variant.size] : []
          )
        )
      ].sort(),
      shortDescription: product.shortDescription,
      variants
    };
    return imageUrl ? { ...projection, imageUrl } : projection;
  }

  async getVariant(
    variantId: string
  ): Promise<ProductVariantProjection | null> {
    const [variant] = await this.db
      .select(this.variantSelection())
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .innerJoin(
        schema.inventory,
        eq(schema.inventory.variantId, schema.productVariants.id)
      )
      .where(
        and(
          eq(schema.productVariants.id, variantId),
          eq(schema.productVariants.status, 'active'),
          eq(schema.products.status, 'active')
        )
      )
      .limit(1);
    return variant ? this.mapVariant(variant) : null;
  }

  async checkInventory(variantId: string): Promise<InventoryProjection | null> {
    const variant = await this.getVariant(variantId);
    return variant
      ? {
          variantId: variant.variantId,
          sku: variant.sku,
          available: variant.available,
          availableQuantity: variant.availableQuantity
        }
      : null;
  }

  private async findActiveVariants(
    productId: string
  ): Promise<ProductVariantProjection[]> {
    const rows = await this.db
      .select(this.variantSelection())
      .from(schema.productVariants)
      .innerJoin(
        schema.products,
        eq(schema.productVariants.productId, schema.products.id)
      )
      .innerJoin(
        schema.inventory,
        eq(schema.inventory.variantId, schema.productVariants.id)
      )
      .where(
        and(
          eq(schema.productVariants.productId, productId),
          eq(schema.productVariants.status, 'active'),
          eq(schema.products.status, 'active')
        )
      )
      .orderBy(asc(schema.productVariants.sku));
    return rows.map((row) => this.mapVariant(row));
  }

  private variantSelection() {
    return {
      variantId: schema.productVariants.id,
      productId: schema.productVariants.productId,
      sku: schema.productVariants.sku,
      title: schema.productVariants.title,
      color: schema.productVariants.color,
      size: schema.productVariants.size,
      price: sql<number>`${schema.productVariants.price}`.mapWith(safeInteger),
      currency: schema.products.currency,
      availableQuantity:
        sql<number>`GREATEST(${schema.inventory.quantityAvailable} - ${schema.inventory.quantityReserved}, 0)`.mapWith(
          safeInteger
        )
    };
  }

  private mapVariant(row: VariantRow): ProductVariantProjection {
    return {
      ...row,
      available: row.availableQuantity > 0
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
