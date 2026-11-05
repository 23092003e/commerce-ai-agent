import { z } from 'zod';
import { assembleAgentContext, type AgentContext } from './agent-context.js';
import {
  AgentReplyDecisionSchema,
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
          decision = DecisionSchema.parse(
            await input.provider.decide({
              context,
              toolResults
            })
          );
          input.metrics?.increment('llm_calls_total', { status: 'success' });
        } catch {
          input.metrics?.increment('llm_calls_total', { status: 'error' });
          input.metrics?.increment('llm_errors_total');
          return {
            type: 'handover',
            reason: 'invalid_provider_decision',
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
          } catch {
            return {
              type: 'handover',
              reason: 'grounding_failed',
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
