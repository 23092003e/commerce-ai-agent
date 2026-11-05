import { describe, expect, it } from 'vitest';
import { runGoldenScenario } from '../src/evals.js';
import { goldenScenarios } from '../src/golden-scenarios.js';

describe('behavioral evaluator rejects incorrect expectations', () => {
  const base = () => structuredClone(goldenScenarios[0]);

  it('passes the real orchestration baseline', async () => {
    const scenario = base();
    if (!scenario) throw new Error('Missing fixture');
    expect((await runGoldenScenario(scenario)).passed).toBe(true);
  });

  it.each([
    'arguments',
    'forbidden',
    'state',
    'facts',
    'outcome',
    'confirmation',
    'chunks'
  ] as const)('fails an incorrect %s contract', async (defect) => {
    const scenario = base();
    if (!scenario) throw new Error('Missing fixture');
    if (defect === 'arguments')
      scenario.expected.calls[0] = {
        name: 'catalog.searchProducts',
        arguments: { query: 'wrong product' }
      };
    if (defect === 'forbidden')
      scenario.expected.forbiddenCalls = ['catalog.searchProducts'];
    if (defect === 'state') scenario.expected.state.cartQuantity = 999;
    if (defect === 'facts')
      scenario.expected.factRefs = [
        {
          type: 'catalog_product',
          productId: '99999999-9999-4999-8999-999999999999'
        }
      ];
    if (defect === 'outcome') scenario.expected.outcome = 'handover';
    if (defect === 'confirmation')
      scenario.expected.state.preparedConfirmationId = 'missing-confirmation';
    if (defect === 'chunks')
      scenario.expected.evidenceChunkIds = [
        '99999999-9999-4999-8999-999999999999'
      ];
    const result = await runGoldenScenario(scenario);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
