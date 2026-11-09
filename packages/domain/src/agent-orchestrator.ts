import { z } from 'zod';
import { DecisionProviderError } from './decision-provider-error.js';
import { assembleAgentContext, type AgentContext } from './agent-context.js';
import {
  AgentReplyDecisionSchema,
  GroundingError,
  validateAndRenderGroundedReply,
  type AgentReplyDecision
} from './grounded-reply.js';
import {
  projectToolEvidence,
  safeToolProviderResult,
  validateAgentToolInput,
  type ToolEvidence,
  type SafeProjection
} from './tool-evidence.js';

const toolNames = [
  'knowledge.search',
  'catalog.searchProducts',
  'catalog.getProduct',
  'catalog.getVariant',
  'catalog.checkInventory',
  'cart.add',
  'cart.update',
  'cart.remove',
  'checkout.start',
  'checkout.setRecipientName',
  'checkout.setPhone',
  'checkout.setAddress',
  'checkout.setPaymentMethod',
  'checkout.prepareConfirmation'
] as const;

const DecisionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('tool'),
      name: z.enum(toolNames),
      input: z.unknown()
    })
    .strict(),
  AgentReplyDecisionSchema,
  z
    .object({
      type: z.literal('handover'),
      reason: z.string().trim().min(1).max(200)
    })
    .strict()
]);

export type StructuredDecision = z.infer<typeof DecisionSchema>;
export interface StructuredDecisionProvider {
  decide(input: {
    context: AgentContext;
    toolResults: unknown[];
  }): Promise<unknown>;
}
export interface AgentTool {
  name: (typeof toolNames)[number];
  execute(input: unknown): Promise<unknown>;
}
export interface AgentToolTrace {
  step: number;
  name: (typeof toolNames)[number];
  status: 'succeeded' | 'failed';
  latencyMs: number;
  argumentSummary: SafeProjection;
  resultSummary: SafeProjection;
  resultRefIds: string[];
  evidence?: ToolEvidence[];
}
export interface AgentTrace {
  toolCalls: AgentToolTrace[];
}
export interface AgentMetrics {
  increment(name: string, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
}
export interface AgentOrchestrator {
  run(input: unknown): Promise<
    | {
        type: 'reply';
        text: string;
        evidenceChunkIds: string[];
        factRefs: AgentReplyDecision['facts'];
        toolSteps: number;
        trace: AgentTrace;
      }
    | {
        type: 'handover';
        reason: string;
        diagnostic?:
          | GroundingError['code']
          | DecisionProviderError['code']
          | 'schema_invalid'
          | 'provider_unknown';
        toolSteps: number;
        trace: AgentTrace;
      }
    | {
        type: 'suppressed';
        reason: 'human_controlled' | 'paused';
        toolSteps: 0;
        trace: AgentTrace;
      }
  >;
}

export function createAgentOrchestrator(input: {
  provider: StructuredDecisionProvider;
  tools: AgentTool[];
  maxToolSteps?: number;
  metrics?: AgentMetrics | undefined;
}): AgentOrchestrator {
  const maxToolSteps = input.maxToolSteps ?? 6;
  if (!Number.isInteger(maxToolSteps) || maxToolSteps < 1 || maxToolSteps > 6) {
    throw new Error('maxToolSteps must be an integer from 1 to 6');
  }
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  return {
    async run(value) {
      const context = assembleAgentContext(value);
      const toolResults: unknown[] = [];
      const toolCalls: AgentToolTrace[] = [];
      if (context.controlMode !== 'ai') {
        return {
          type: 'suppressed',
          reason:
            context.controlMode === 'human' ? 'human_controlled' : 'paused',
          toolSteps: 0,
          trace: { toolCalls }
        };
      }
      const generalCatalogQuestion =
        /^(?:xin chào[,!. ]*)?(?:cửa hàng|shop|tiệm)(?: đang)? (?:bán|có) (?:(?:những|các|loại) )*(?:sản phẩm|bánh|gì)(?: nào| gì)?[?.! ]*$/iu.test(
          context.customerMessage.trim().normalize('NFC')
        );
      const catalogSearch = tools.get('catalog.searchProducts');
      if (generalCatalogQuestion && catalogSearch) {
        const args = { inStockOnly: true, limit: 3 };
        try {
          const startedAt = performance.now();
          const result = await catalogSearch.execute(args);
          const trace = projectToolEvidence(
            catalogSearch.name,
            args,
            result,
            1
          );
          trace.latencyMs = Math.round(performance.now() - startedAt);
          toolCalls.push(trace);
          const facts: AgentReplyDecision['facts'] = (trace.evidence ?? [])
            .filter((item) => item.type === 'catalog_product')
            .slice(0, 3)
            .map((item) => ({
              type: 'catalog_product',
              productId: item.value.productId
            }));
          if (facts.length) {
            const rendered = validateAndRenderGroundedReply({
              decision: {
                type: 'reply',
                intro: 'Dạ em gửi anh/chị thông tin đã kiểm tra.',
                facts
              },
              ledger: toolCalls,
              locale: 'vi-VN'
            });
            input.metrics?.increment('tool_calls_total', {
              toolName: catalogSearch.name,
              status: 'success'
            });
            return {
              type: 'reply',
              ...rendered,
              factRefs: facts,
              toolSteps: 1,
              trace: { toolCalls }
            };
          }
        } catch {
          return {
            type: 'handover',
            reason: 'catalog_unavailable',
            toolSteps: 1,
            trace: { toolCalls }
          };
        }
      }
      const priceAndStock =
        /^(.{2,100}?)\s+giá bao nhiêu\s*[,;]?\s*còn hàng không[?.! ]*$/iu.exec(
          context.customerMessage.trim().normalize('NFC')
        );
      const productLookup = tools.get('catalog.getProduct');
      const inventoryLookup = tools.get('catalog.checkInventory');
      if (
        priceAndStock?.[1] &&
        catalogSearch &&
        productLookup &&
        inventoryLookup &&
        maxToolSteps >= 4
      ) {
        const productName = priceAndStock[1].trim();
        try {
          const runLookup = async (tool: AgentTool, args: unknown) => {
            const startedAt = performance.now();
            const result = await tool.execute(
              validateAgentToolInput(tool.name, args)
            );
            const trace = projectToolEvidence(
              tool.name,
              args,
              result,
              toolCalls.length + 1
            );
            trace.latencyMs = Math.round(performance.now() - startedAt);
            toolCalls.push(trace);
            toolResults.push(safeToolProviderResult(trace));
            input.metrics?.increment('tool_calls_total', {
              toolName: tool.name,
              status: 'success'
            });
            return trace;
          };
          const search = await runLookup(catalogSearch, {
            query: productName,
            inStockOnly: false,
            limit: 5
          });
          const matches = (search.evidence ?? []).filter(
            (item) =>
              item.type === 'catalog_product' &&
              item.value.name.toLocaleLowerCase('vi-VN') ===
                productName.toLocaleLowerCase('vi-VN')
          );
          if (matches.length === 1 && matches[0]?.type === 'catalog_product') {
            const productId = matches[0].value.productId;
            const detail = await runLookup(productLookup, { productId });
            const variants = (detail.evidence ?? [])
              .filter(
                (item) =>
                  item.type === 'catalog_variant' &&
                  item.value.productId === productId
              )
              .slice(0, 2);
            const facts: AgentReplyDecision['facts'] = [
              { type: 'catalog_product', productId }
            ];
            for (const variant of variants) {
              if (variant.type !== 'catalog_variant') continue;
              const inventory = await runLookup(inventoryLookup, {
                variantId: variant.value.variantId
              });
              if (
                !inventory.evidence?.some(
                  (item) =>
                    item.type === 'inventory' &&
                    item.value.variantId === variant.value.variantId
                )
              )
                throw new Error('inventory evidence missing');
              facts.push(
                { type: 'catalog_variant', variantId: variant.value.variantId },
                { type: 'inventory', variantId: variant.value.variantId }
              );
            }
            if (variants.length) {
              const rendered = validateAndRenderGroundedReply({
                decision: {
                  type: 'reply',
                  intro: 'Dạ em gửi anh/chị thông tin đã kiểm tra.',
                  facts
                },
                ledger: toolCalls,
                locale: 'vi-VN'
              });
              return {
                type: 'reply',
                ...rendered,
                factRefs: facts,
                toolSteps: toolCalls.length,
                trace: { toolCalls }
              };
            }
          }
        } catch {
          return {
            type: 'handover',
            reason: 'catalog_unavailable',
            toolSteps: toolCalls.length,
            trace: { toolCalls }
          };
        }
      }
      const referencePosition = /(?:mẫu|mau|option|item)\s*(\d{1,2})\b/iu.exec(
        context.customerMessage
      )?.[1];
      if (referencePosition) {
        const reference = context.productReferences.find(
          (item) => item.position === Number(referencePosition)
        );
        const tool = reference?.variantId
          ? tools.get('catalog.getVariant')
          : tools.get('catalog.getProduct');
        if (!reference || !tool)
          return {
            type: 'handover',
            reason: 'invalid_product_reference',
            toolSteps: 0,
            trace: { toolCalls }
          };
        const args = reference.variantId
          ? { variantId: reference.variantId }
          : { productId: reference.productId };
        try {
          const result = await tool.execute(args);
          const trace = projectToolEvidence(tool.name, args, result, 1);
          if (
            !trace.evidence?.length ||
            (reference.variantId &&
              !trace.evidence.some(
                (item) =>
                  item.type === 'catalog_variant' &&
                  item.value.productId === reference.productId
              ))
          )
            return {
              type: 'handover',
              reason: 'invalid_product_reference',
              toolSteps: 1,
              trace: { toolCalls }
            };
          toolCalls.push(trace);
          toolResults.push(safeToolProviderResult(trace));
        } catch {
          return {
            type: 'handover',
            reason: 'invalid_product_reference',
            toolSteps: 1,
            trace: { toolCalls }
          };
        }
      }
      for (
        let toolSteps = toolCalls.length;
        toolSteps < maxToolSteps;
        toolSteps += 1
      ) {
        let decision: StructuredDecision;
        const providerStartedAt = performance.now();
        try {
          try {
            decision = DecisionSchema.parse(
              await input.provider.decide({ context, toolResults })
            );
          } catch (error) {
            if (
              !(error instanceof z.ZodError) &&
              !(
                error instanceof DecisionProviderError &&
                (error.code === 'invalid_response' ||
                  error.code === 'output_limit')
              )
            )
              throw error;
            input.metrics?.increment('llm_calls_total', { status: 'error' });
            input.metrics?.increment('llm_errors_total');
            decision = DecisionSchema.parse(
              await input.provider.decide({ context, toolResults })
            );
          }
          input.metrics?.increment('llm_calls_total', { status: 'success' });
        } catch (error) {
          input.metrics?.increment('llm_calls_total', { status: 'error' });
          input.metrics?.increment('llm_errors_total');
          return {
            type: 'handover',
            reason: 'invalid_provider_decision',
            diagnostic:
              error instanceof DecisionProviderError
                ? error.code
                : error instanceof z.ZodError
                  ? 'schema_invalid'
                  : 'provider_unknown',
            toolSteps,
            trace: { toolCalls }
          };
        } finally {
          input.metrics?.observe(
            'llm_duration_ms',
            Math.round(performance.now() - providerStartedAt)
          );
        }
        if (decision.type === 'reply') {
          try {
            const rendered = validateAndRenderGroundedReply({
              decision,
              ledger: toolCalls,
              locale: 'vi-VN'
            });
            return {
              type: 'reply',
              ...rendered,
              factRefs: decision.facts,
              toolSteps,
              trace: { toolCalls }
            };
          } catch (error) {
            if (
              error instanceof GroundingError &&
              (error.code === 'unsafe_intro' ||
                error.code === 'unsafe_question') &&
              decision.facts.length > 0
            ) {
              try {
                const rendered = validateAndRenderGroundedReply({
                  decision: { type: 'reply', facts: decision.facts },
                  ledger: toolCalls,
                  locale: 'vi-VN'
                });
                return {
                  type: 'reply',
                  ...rendered,
                  factRefs: decision.facts,
                  toolSteps,
                  trace: { toolCalls }
                };
              } catch {
                // An unverified reference must still result in a handover.
              }
            }
            return {
              type: 'handover',
              reason: 'grounding_failed',
              ...(error instanceof GroundingError
                ? { diagnostic: error.code }
                : {}),
              toolSteps,
              trace: { toolCalls }
            };
          }
        }
        if (decision.type === 'handover')
          return { ...decision, toolSteps, trace: { toolCalls } };
        const tool = tools.get(decision.name);
        if (!tool)
          return {
            type: 'handover',
            reason: 'tool_not_authorized',
            toolSteps,
            trace: { toolCalls }
          };
        const startedAt = performance.now();
        try {
          const validatedInput = validateAgentToolInput(
            decision.name,
            decision.input
          );
          const result = await tool.execute(validatedInput);
          const trace = projectToolEvidence(
            decision.name,
            decision.input,
            result,
            toolSteps + 1
          );
          trace.latencyMs = Math.round(performance.now() - startedAt);
          toolCalls.push(trace);
          toolResults.push(safeToolProviderResult(trace));
          input.metrics?.increment('tool_calls_total', {
            toolName: decision.name,
            status: 'success'
          });
          if (decision.name === 'knowledge.search') {
            const hasEvidence =
              trace.evidence?.some((item) => item.type === 'knowledge') ??
              false;
            input.metrics?.increment('rag_searches_total', {
              status: hasEvidence ? 'evidence' : 'insufficient_evidence'
            });
            if (!hasEvidence) input.metrics?.increment('rag_no_evidence_total');
          }
        } catch {
          input.metrics?.increment('tool_calls_total', {
            toolName: decision.name,
            status: 'error'
          });
          input.metrics?.increment('tool_errors_total', {
            toolName: decision.name
          });
          toolCalls.push({
            step: toolSteps + 1,
            name: decision.name,
            status: 'failed',
            argumentSummary: projectToolEvidence(
              decision.name,
              decision.input,
              null,
              toolSteps + 1
            ).argumentSummary,
            resultSummary: {},
            resultRefIds: [],
            latencyMs: Math.round(performance.now() - startedAt)
          });
          return {
            type: 'handover',
            reason: 'tool_failed',
            toolSteps: toolSteps + 1,
            trace: { toolCalls }
          };
        } finally {
          input.metrics?.observe(
            'tool_duration_ms',
            Math.round(performance.now() - startedAt),
            { toolName: decision.name }
          );
        }
      }
      return {
        type: 'handover',
        reason: 'tool_step_limit',
        toolSteps: maxToolSteps,
        trace: { toolCalls }
      };
    }
  };
}
