import { z } from 'zod';
import { assembleAgentContext, type AgentContext } from './agent-context.js';

const toolNames = [
  'knowledge.search',
  'catalog.searchProducts',
  'catalog.getProduct',
  'catalog.getVariant',
  'catalog.checkInventory',
  'cart.add',
  'cart.update',
  'cart.remove'
] as const;

const DecisionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('tool'),
      name: z.enum(toolNames),
      input: z.unknown()
    })
    .strict(),
  z
    .object({
      type: z.literal('reply'),
      text: z.string().trim().min(1).max(2_000),
      evidenceChunkIds: z.array(z.uuid()).max(10).default([])
    })
    .strict(),
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
  name: (typeof toolNames)[number];
  status: 'succeeded' | 'failed';
  latencyMs: number;
}
export interface AgentTrace {
  toolCalls: AgentToolTrace[];
}
export interface AgentOrchestrator {
  run(input: unknown): Promise<
    | {
        type: 'reply';
        text: string;
        evidenceChunkIds: string[];
        toolSteps: number;
        trace: AgentTrace;
      }
    | {
        type: 'handover';
        reason: string;
        toolSteps: number;
        trace: AgentTrace;
      }
  >;
}

export function createAgentOrchestrator(input: {
  provider: StructuredDecisionProvider;
  tools: AgentTool[];
  maxToolSteps?: number;
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
      for (let toolSteps = 0; toolSteps < maxToolSteps; toolSteps += 1) {
        const decision = DecisionSchema.parse(
          await input.provider.decide({
            context,
            toolResults
          })
        );
        if (decision.type === 'reply')
          return { ...decision, toolSteps, trace: { toolCalls } };
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
          toolResults.push(await tool.execute(decision.input));
          toolCalls.push({
            name: decision.name,
            status: 'succeeded',
            latencyMs: Math.round(performance.now() - startedAt)
          });
        } catch {
          toolCalls.push({
            name: decision.name,
            status: 'failed',
            latencyMs: Math.round(performance.now() - startedAt)
          });
          return {
            type: 'handover',
            reason: 'tool_failed',
            toolSteps: toolSteps + 1,
            trace: { toolCalls }
          };
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
