import { describe, expect, it } from 'vitest';
import { goldenScenarios, runGoldenScenario } from '../src/index.js';

describe('golden scenarios', () => {
  it('covers at least fifty uniquely named scenarios across every release-risk category', () => {
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
  });

  it('passes every deterministic golden scenario', async () => {
    const results = await Promise.all(goldenScenarios.map(runGoldenScenario));
    expect(results.filter((result) => !result.passed)).toEqual([]);
  });
});
