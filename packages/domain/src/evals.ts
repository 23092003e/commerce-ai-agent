import { isDeepStrictEqual } from 'node:util';
import {
  createAgentOrchestrator,
  type AgentTool,
  type StructuredDecisionProvider
} from './agent-orchestrator.js';
import { createScriptedDecisionProvider } from './fake-decision-provider.js';
import type { AgentReplyDecision } from './grounded-reply.js';
import {
  createEvalHarness,
  type EvalState,
  type EvalToolFixtures
} from './eval-fixtures.js';

export interface GoldenExpected {
  outcome: 'reply' | 'handover' | 'suppressed';
  calls: Array<{ name: AgentTool['name']; arguments: unknown }>;
  factRefs: AgentReplyDecision['facts'];
  evidenceChunkIds: string[];
  state: EvalState;
  forbiddenCalls: AgentTool['name'][];
  forbiddenEffects: Array<
    'order_created' | 'inventory_reserved' | 'cart_changed'
  >;
  reason?: string;
  replyContains?: string[];
}
export interface GoldenScenario {
  id: string;
  initialState: EvalState;
  toolFixtures: EvalToolFixtures;
  allowedCalls: AgentTool['name'][];
  turns: Array<{
    input: Record<string, unknown>;
    decisions: unknown[];
    after?: 'confirm' | 'stale_confirm' | 'expired_confirm' | 'replay_confirm';
  }>;
  failureInjection: boolean;
  expected: GoldenExpected;
}
export interface GoldenScenarioResult {
  id: string;
  passed: boolean;
  failures: string[];
  assertionCount: number;
}

export async function runGoldenScenario(
  scenario: GoldenScenario,
  options: { provider?: StructuredDecisionProvider } = {}
): Promise<GoldenScenarioResult> {
  const harness = createEvalHarness(
    scenario.initialState,
    scenario.toolFixtures
  );
  const calls: GoldenExpected['calls'] = [];
  const tools = harness.tools
    .filter((tool) => scenario.allowedCalls.includes(tool.name))
    .map((tool): AgentTool => ({
      ...tool,
      execute: async (argumentsValue) => {
        calls.push({
          name: tool.name,
          arguments: structuredClone(argumentsValue)
        });
        return tool.execute(argumentsValue);
      }
    }));
  let result:
    | Awaited<ReturnType<ReturnType<typeof createAgentOrchestrator>['run']>>
    | undefined;
  const failures: string[] = [];
  let assertionCount = 0;
  const check = (condition: boolean, message: string) => {
    assertionCount++;
    if (!condition) failures.push(message);
  };
  try {
    for (const turn of scenario.turns) {
      result = await createAgentOrchestrator({
        provider:
          options.provider ?? createScriptedDecisionProvider(turn.decisions),
        tools
      }).run(turn.input);
      if (turn.after) await harness.after(turn.after);
    }
  } catch {
    failures.push('scenario execution failed');
  }
  const expected = scenario.expected;
  check(
    result?.type === expected.outcome,
    `outcome must be ${expected.outcome}`
  );
  check(
    isDeepStrictEqual(calls, expected.calls),
    'tool calls or validated arguments differ'
  );
  check(
    !calls.some((call) => expected.forbiddenCalls.includes(call.name)),
    'forbidden tool call occurred'
  );
  check(
    isDeepStrictEqual(
      result?.type === 'reply' ? result.factRefs : [],
      expected.factRefs
    ),
    'fact references differ'
  );
  check(
    isDeepStrictEqual(
      result?.type === 'reply' ? result.evidenceChunkIds : [],
      expected.evidenceChunkIds
    ),
    'evidence chunk IDs differ'
  );
  check(
    isDeepStrictEqual(harness.state, expected.state),
    'final domain state differs'
  );
  for (const effect of expected.forbiddenEffects) {
    const safe =
      effect === 'order_created'
        ? harness.state.orderCount === scenario.initialState.orderCount
        : effect === 'inventory_reserved'
          ? harness.state.reservedQuantity ===
            scenario.initialState.reservedQuantity
          : harness.state.cartQuantity === scenario.initialState.cartQuantity &&
            harness.state.cartVersion === scenario.initialState.cartVersion;
    check(safe, `forbidden effect: ${effect}`);
  }
  if (expected.reason)
    check(
      result?.type === 'handover' && result.reason === expected.reason,
      'handover reason differs'
    );
  for (const fragment of expected.replyContains ?? [])
    check(
      result?.type === 'reply' && result.text.includes(fragment),
      'rendered reply lacks required verified content'
    );
  return {
    id: scenario.id,
    passed: failures.length === 0,
    failures,
    assertionCount
  };
}
