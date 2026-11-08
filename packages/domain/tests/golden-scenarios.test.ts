import { describe, expect, it } from 'vitest';
import { goldenScenarios } from '../src/golden-scenarios.js';
import { runGoldenScenario } from '../src/evals.js';

describe('behavioral golden release contracts', () => {
  it('covers all risk categories, at least fifty literal cases and cross-turn/failure paths', () => {
    expect(goldenScenarios.length).toBeGreaterThanOrEqual(50);
    expect(new Set(goldenScenarios.map((scenario) => scenario.id)).size).toBe(
      goldenScenarios.length
    );
    expect(
      new Set(goldenScenarios.map((scenario) => scenario.category))
    ).toEqual(
      new Set([
        'product',
        'knowledge',
        'cart',
        'checkout',
        'inventory',
        'safety',
        'human'
      ])
    );
    expect(
      goldenScenarios.filter((scenario) => scenario.turns.length > 1).length
    ).toBeGreaterThanOrEqual(5);
    expect(
      goldenScenarios.filter((scenario) => scenario.failureInjection).length
    ).toBeGreaterThanOrEqual(5);
    for (const scenario of goldenScenarios) {
      expect(Object.keys(scenario.expected)).toEqual(
        expect.arrayContaining([
          'outcome',
          'calls',
          'factRefs',
          'evidenceChunkIds',
          'state',
          'forbiddenCalls',
          'forbiddenEffects'
        ])
      );
    }
  });

  for (const scenario of goldenScenarios) {
    it(`${scenario.category}: ${scenario.id}`, async () => {
      const result = await runGoldenScenario(scenario);
      expect(result.failures).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.assertionCount).toBeGreaterThanOrEqual(6);
    });
  }
});
