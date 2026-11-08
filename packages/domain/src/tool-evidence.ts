import { z } from 'zod';
import type { AgentToolTrace, AgentTool } from './agent-orchestrator.js';
import { CheckoutDraftSchema } from './checkout-flow.js';
import { PreparedCheckoutSnapshotSchema } from './checkout.js';
import {
  ProductSearchSchema,
  ProductLookupSchema,
  VariantLookupSchema
} from './catalog.js';
import { KnowledgeSearchSchema } from './knowledge.js';
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[A-Z]{3}$/u);
const product = z.object({
  productId: z.uuid(),
  name: z.string().min(1).max(200),
  priceFrom: money,
  currency
});
const variant = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  sku: z.string().max(100),
  title: z.string().max(200),
  price: money,
  currency,
  availableQuantity: z.number().int().nonnegative()
});
const inventory = z.object({
  variantId: z.uuid(),
  availableQuantity: z.number().int().nonnegative()
});
const cart = z.object({
  id: z.uuid(),
  currency,
  subtotal: money,
  total: money,
  lines: z
    .array(
      z.object({
        variantId: z.uuid(),
        title: z.string().max(200),
        quantity: z.number().int().min(1).max(99),
        unitPrice: money,
        lineTotal: money
      })
    )
    .max(100)
});
const chunk = z.object({
  chunkId: z.uuid(),
  documentId: z.uuid(),
  content: z.string().min(1).max(10000),
  status: z.literal('active').optional()
});
export type ToolEvidence =
  | { type: 'catalog_product'; value: z.infer<typeof product> }
  | { type: 'catalog_variant'; value: z.infer<typeof variant> }
  | { type: 'inventory'; value: z.infer<typeof inventory> }
  | { type: 'cart'; value: z.infer<typeof cart> }
  | { type: 'knowledge'; value: z.infer<typeof chunk> }
  | {
      type: 'checkout_confirmation';
      value: { confirmationId: string; total: number; currency: string };
    }
  | { type: 'order'; value: { orderId: string; orderNumber: string } };
export type SafeProjection = Record<string, string | number | boolean | null>;
const version = z.number().int().positive();
const line = z
  .object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(99) })
  .strict();
export const agentToolInputSchemas = {
  'knowledge.search': KnowledgeSearchSchema,
  'catalog.searchProducts': ProductSearchSchema,
  'catalog.getProduct': ProductLookupSchema,
  'catalog.getVariant': VariantLookupSchema,
  'catalog.checkInventory': VariantLookupSchema,
  'cart.add': line,
  'cart.update': line,
  'cart.remove': line.omit({ quantity: true }),
  'checkout.start': z.object({}).strict(),
  'checkout.prepareConfirmation': z.object({}).strict(),
  'checkout.setRecipientName': z
    .object({
      expectedVersion: version,
      recipientName: z.string().trim().min(1).max(120)
    })
    .strict(),
  'checkout.setPhone': z
    .object({
      expectedVersion: version,
      phone: z.string().trim().min(6).max(32)
    })
    .strict(),
  'checkout.setAddress': z
    .object({
      expectedVersion: version,
      address: z
        .object({
          line1: z.string().min(1).max(200),
          ward: z.string().min(1).max(100),
          city: z.string().min(1).max(100)
        })
        .strict()
    })
    .strict(),
  'checkout.setPaymentMethod': z
    .object({
      expectedVersion: version,
      paymentMethod: z.enum(['cod', 'bank_transfer', 'other'])
    })
    .strict()
};
export function validateAgentToolInput(
  name: AgentTool['name'],
  value: unknown
): unknown {
  return agentToolInputSchemas[name].parse(value);
}

/** Each tool gets an explicit bounded projection; no arbitrary nested input is serialized. */
export function projectToolEvidence(
  name: AgentTool['name'],
  args: unknown,
  result: unknown,
  step: number
): AgentToolTrace {
  const argumentSummary: SafeProjection = {};
  const a = z
    .object({
      productId: z.uuid().optional(),
      variantId: z.uuid().optional(),
      quantity: z.number().int().min(1).max(99).optional(),
      expectedVersion: z.number().int().positive().optional()
    })
    .safeParse(args);
  if (a.success) {
    if (name === 'catalog.getProduct' && a.data.productId)
      argumentSummary.productId = a.data.productId;
    if (
      [
        'catalog.getVariant',
        'catalog.checkInventory',
        'cart.add',
        'cart.update',
        'cart.remove'
      ].includes(name) &&
      a.data.variantId
    )
      argumentSummary.variantId = a.data.variantId;
    if (['cart.add', 'cart.update'].includes(name) && a.data.quantity)
      argumentSummary.quantity = a.data.quantity;
    if (name.startsWith('checkout.') && a.data.expectedVersion)
      argumentSummary.expectedVersion = a.data.expectedVersion;
  }
  const evidence: ToolEvidence[] = [];
  if (name === 'catalog.searchProducts') {
    const parsed = z
      .object({ products: z.array(product).max(10) })
      .safeParse(result);
    if (parsed.success)
      for (const value of parsed.data.products)
        evidence.push({ type: 'catalog_product', value });
  }
  if (name === 'catalog.getProduct') {
    const parsed = product
      .extend({ variants: z.array(variant).max(100) })
      .safeParse(result);
    if (parsed.success) {
      evidence.push({ type: 'catalog_product', value: parsed.data });
      for (const value of parsed.data.variants)
        evidence.push({ type: 'catalog_variant', value });
    }
  }
  if (name === 'catalog.getVariant') {
    const parsed = variant.safeParse(result);
    if (parsed.success)
      evidence.push({ type: 'catalog_variant', value: parsed.data });
  }
  if (name === 'catalog.checkInventory') {
    const parsed = inventory.safeParse(result);
    if (parsed.success)
      evidence.push({ type: 'inventory', value: parsed.data });
  }
  if (name === 'cart.add' || name === 'cart.update') {
    const parsed = cart.safeParse(result);
    if (parsed.success) evidence.push({ type: 'cart', value: parsed.data });
  }
  if (name === 'knowledge.search') {
    const parsed = z
      .object({
        type: z.literal('evidence'),
        chunks: z.array(chunk).min(1).max(10)
      })
      .safeParse(result);
    if (parsed.success)
      for (const value of parsed.data.chunks)
        evidence.push({ type: 'knowledge', value });
  }
  if (name === 'checkout.prepareConfirmation') {
    const parsed = z
      .object({
        confirmationId: z.string().min(1).max(200),
        snapshot: PreparedCheckoutSnapshotSchema
      })
      .safeParse(result);
    if (parsed.success)
      evidence.push({
        type: 'checkout_confirmation',
        value: {
          confirmationId: parsed.data.confirmationId,
          total: parsed.data.snapshot.total,
          currency: parsed.data.snapshot.currency
        }
      });
  }
  const resultSummary: SafeProjection = { evidenceCount: evidence.length };
  const resultRefIds: string[] = [];
  for (const [index, fact] of evidence.entries()) {
    const prefix = `fact${String(index)}`;
    if (fact.type === 'catalog_product') {
      resultRefIds.push(fact.value.productId);
      resultSummary[`${prefix}ProductId`] = fact.value.productId;
      resultSummary[`${prefix}Price`] = fact.value.priceFrom;
    }
    if (fact.type === 'catalog_variant') {
      resultRefIds.push(fact.value.variantId);
      resultSummary[`${prefix}VariantId`] = fact.value.variantId;
      resultSummary[`${prefix}Price`] = fact.value.price;
    }
    if (fact.type === 'inventory') {
      resultRefIds.push(fact.value.variantId);
      resultSummary[`${prefix}VariantId`] = fact.value.variantId;
      resultSummary[`${prefix}Available`] = fact.value.availableQuantity;
    }
    if (fact.type === 'cart') {
      resultRefIds.push(fact.value.id);
      resultSummary.cartId = fact.value.id;
      resultSummary.total = fact.value.total;
    }
    if (fact.type === 'knowledge') {
      resultRefIds.push(fact.value.chunkId, fact.value.documentId);
      resultSummary[`${prefix}ChunkId`] = fact.value.chunkId;
      resultSummary[`${prefix}DocumentId`] = fact.value.documentId;
    }
    if (fact.type === 'checkout_confirmation') {
      resultRefIds.push(fact.value.confirmationId);
      resultSummary.confirmationId = fact.value.confirmationId;
      resultSummary.total = fact.value.total;
    }
  }
  const draft = name.startsWith('checkout.')
    ? CheckoutDraftSchema.safeParse(result)
    : null;
  if (draft?.success) {
    resultSummary.checkoutState = draft.data.state;
    resultSummary.checkoutVersion = draft.data.version;
  }
  return {
    step,
    name,
    status: 'succeeded',
    argumentSummary,
    resultSummary,
    resultRefIds: [...new Set(resultRefIds)].slice(0, 220),
    evidence,
    latencyMs: 0
  };
}

export function safeToolProviderResult(trace: AgentToolTrace): unknown {
  return { name: trace.name, ...trace.resultSummary, evidence: trace.evidence };
}
