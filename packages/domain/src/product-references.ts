import { z } from 'zod';

const ProductReferenceItemSchema = z
  .object({
    position: z.number().int().min(1).max(10),
    productId: z.uuid(),
    variantId: z.uuid().nullable()
  })
  .strict();

export const SaveProductReferencesSchema = z
  .object({
    conversationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    turnId: z.uuid(),
    items: z.array(ProductReferenceItemSchema).min(1).max(10)
  })
  .strict()
  .refine(
    ({ items }) => {
      const positions = items
        .map(({ position }) => position)
        .sort((a, b) => a - b);
      return positions.every((position, index) => position === index + 1);
    },
    {
      message: 'Reference positions must be contiguous from 1',
      path: ['items']
    }
  );

export interface ProductReferenceItem {
  position: number;
  productId: string;
  variantId: string | null;
}

export interface ProductReferences {
  turnId: string;
  items: ProductReferenceItem[];
}

export interface SaveProductReferencesRepositoryInput {
  conversationId: string;
  expectedVersion: number;
  references: ProductReferences;
}

export type SaveProductReferencesResult =
  | { type: 'updated'; version: number; references: ProductReferences }
  | { type: 'conflict'; currentVersion: number }
  | { type: 'not_found' }
  | { type: 'invalid_reference' };

export interface ProductReferenceStore {
  saveProductReferences(
    input: SaveProductReferencesRepositoryInput
  ): Promise<SaveProductReferencesResult>;
}

export interface ProductReferenceService {
  saveProductReferences(input: unknown): Promise<SaveProductReferencesResult>;
  resolveProductReference(
    references: ProductReferences,
    position: number
  ): ProductReferenceItem | null;
}

export function createProductReferenceService(
  store: ProductReferenceStore
): ProductReferenceService {
  return {
    async saveProductReferences(input) {
      const parsed = SaveProductReferencesSchema.parse(input);
      return store.saveProductReferences({
        conversationId: parsed.conversationId,
        expectedVersion: parsed.expectedVersion,
        references: {
          turnId: parsed.turnId,
          items: parsed.items.toSorted(
            (left, right) => left.position - right.position
          )
        }
      });
    },
    resolveProductReference(references, position) {
      return (
        references.items.find((item) => item.position === position) ?? null
      );
    }
  };
}
