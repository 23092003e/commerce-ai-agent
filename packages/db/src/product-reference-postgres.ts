import type {
  ProductReferenceStore,
  SaveProductReferencesRepositoryInput,
  SaveProductReferencesResult
} from '@fanpage/domain';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export class PostgresProductReferenceStore implements ProductReferenceStore {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool, { schema });
  }

  async saveProductReferences(
    input: SaveProductReferencesRepositoryInput
  ): Promise<SaveProductReferencesResult> {
    return this.db.transaction(async (tx) => {
      for (const reference of input.references.items) {
        const [product] = await tx
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(eq(schema.products.id, reference.productId))
          .limit(1);
        if (!product) return { type: 'invalid_reference' };

        if (reference.variantId) {
          const [variant] = await tx
            .select({ id: schema.productVariants.id })
            .from(schema.productVariants)
            .where(
              and(
                eq(schema.productVariants.id, reference.variantId),
                eq(schema.productVariants.productId, reference.productId)
              )
            )
            .limit(1);
          if (!variant) return { type: 'invalid_reference' };
        }
      }

      const [updated] = await tx
        .update(schema.conversations)
        .set({
          currentProductRefs: input.references,
          version: sql`${schema.conversations.version} + 1`,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(schema.conversations.id, input.conversationId),
            eq(schema.conversations.version, input.expectedVersion)
          )
        )
        .returning({ version: schema.conversations.version });
      if (updated) {
        return {
          type: 'updated',
          version: updated.version,
          references: input.references
        };
      }

      const [current] = await tx
        .select({ version: schema.conversations.version })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, input.conversationId))
        .limit(1);
      return current
        ? { type: 'conflict', currentVersion: current.version }
        : { type: 'not_found' };
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
