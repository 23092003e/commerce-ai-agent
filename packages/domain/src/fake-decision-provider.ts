import type { StructuredDecisionProvider } from './agent-orchestrator.js';

export function createScriptedDecisionProvider(
  decisions: unknown[]
): StructuredDecisionProvider {
  let index = 0;
  return {
    async decide() {
      const decision = decisions[index];
      index += 1;
      return decision ?? { type: 'handover', reason: 'script_exhausted' };
    }
  };
}
