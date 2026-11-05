import { describe, expect, it, vi } from 'vitest';
import {
  parseLiveEvaluationOptions,
  runLiveAgentEvaluation
} from './evaluate-live-agent.js';

const env = {
  AI_PROVIDER: 'openai',
  AI_MODEL: 'evaluation-model',
  AI_API_KEY: 'never-print-this-key'
};

describe('opt-in live evaluation guards', () => {
  it('requires explicit live opt-in before any provider call', () => {
    expect(() => parseLiveEvaluationOptions([], env)).toThrow('--live');
  });
  it.each(['AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY'])('requires %s', (key) => {
    expect(() =>
      parseLiveEvaluationOptions(['--live'], { ...env, [key]: undefined })
    ).toThrow(key);
  });
  it('defaults to twenty non-mutating cases and at most three concurrent requests', () => {
    expect(parseLiveEvaluationOptions(['--live'], env)).toMatchObject({
      count: 20,
      concurrency: 3,
      minimumPassRate: 0.95
    });
    expect(() =>
      parseLiveEvaluationOptions(['--live', '--concurrency', '4'], env)
    ).toThrow('concurrency');
    expect(() =>
      parseLiveEvaluationOptions(['--live', '--count', '0'], env)
    ).toThrow('count');
    expect(() =>
      parseLiveEvaluationOptions(['--live', '--unknown'], env)
    ).toThrow('Unknown');
  });
  it('never exposes credentials, customer text or raw provider errors in reports', async () => {
    const decide = vi.fn(async () => {
      throw new Error('never-print-this-key private customer text');
    });
    const options = parseLiveEvaluationOptions(['--live', '--count', '2'], env);
    const report = await runLiveAgentEvaluation(options, {
      provider: { decide }
    });
    expect(report.passed).toBe(false);
    expect(report.passRate).toBe(0);
    expect(report.scenarioCount).toBe(2);
    expect(decide).toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('never-print-this-key');
    expect(JSON.stringify(report)).not.toContain('private customer text');
    expect(report.tokenUsage).toEqual({ input: 0, output: 0, known: false });
  });

  it('caps concurrent provider work and keeps all evaluation tools non-mutating', async () => {
    let active = 0;
    let maximum = 0;
    const options = parseLiveEvaluationOptions(['--live', '--count', '5'], env);
    const report = await runLiveAgentEvaluation(options, {
      provider: {
        async decide() {
          active++;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
          return { type: 'handover', reason: 'fixture_result' };
        }
      }
    });
    expect(maximum).toBeLessThanOrEqual(3);
    expect(report.scenarioCount).toBe(5);
  });

  it('reports provider token usage without returning response bodies', async () => {
    const options = parseLiveEvaluationOptions(['--live', '--count', '2'], env);
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            usage: { input_tokens: 7, output_tokens: 3 },
            output: [
              {
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      type: 'handover',
                      reason: 'fixture_result'
                    })
                  }
                ]
              }
            ]
          })
        )
    );
    const report = await runLiveAgentEvaluation(options, { fetch: fakeFetch });
    expect(report.tokenUsage).toEqual({ input: 14, output: 6, known: true });
    expect(JSON.stringify(report)).not.toContain('output_text');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
});
