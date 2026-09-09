import {
  createAgentOrchestrator,
  type AgentTool
} from './agent-orchestrator.js';
import { createScriptedDecisionProvider } from './fake-decision-provider.js';

export interface GoldenScenario {
  id: string;
  input: unknown;
  decisions: unknown[];
  tools: AgentTool[];
  expected: {
    type: 'reply' | 'handover' | 'suppressed';
    toolNames: AgentTool['name'][];
  };
}

export interface GoldenScenarioResult {
  id: string;
  passed: boolean;
  failures: string[];
}

export async function runGoldenScenario(
  scenario: GoldenScenario
): Promise<GoldenScenarioResult> {
  const result = await createAgentOrchestrator({
    provider: createScriptedDecisionProvider(scenario.decisions),
    tools: scenario.tools
  }).run(scenario.input);
  const failures: string[] = [];
  if (result.type !== scenario.expected.type) {
    failures.push(
      `expected outcome ${scenario.expected.type} but received ${result.type}`
    );
  }
  const toolNames = result.trace.toolCalls.map((call) => call.name);
  if (toolNames.join('|') !== scenario.expected.toolNames.join('|')) {
    failures.push(
      `expected tools ${scenario.expected.toolNames.join(',')} but received ${toolNames.join(',')}`
    );
  }
  return { id: scenario.id, passed: failures.length === 0, failures };
}
