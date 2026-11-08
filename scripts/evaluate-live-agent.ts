import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  createOpenAiDecisionProvider,
  type StructuredDecisionProvider
} from '../packages/domain/src/index.js';
import {
  runGoldenScenario,
  type GoldenScenarioResult
} from '../packages/domain/src/evals.js';
import { goldenScenarios } from '../packages/domain/src/golden-scenarios.js';

export interface LiveEvaluationOptions {
  provider: 'openai' | 'openrouter';
  model: string;
  apiKey: string;
  count: number;
  concurrency: number;
  minimumPassRate: number;
}
export function parseLiveEvaluationOptions(
  args: string[],
  environment: NodeJS.ProcessEnv
): LiveEvaluationOptions {
  if (!args.includes('--live'))
    throw new Error(
      'Explicit --live opt-in is required; this command uses paid provider requests'
    );
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--live') continue;
    if (!key || !['--count', '--concurrency'].includes(key))
      throw new Error('Unknown evaluation option');
    const value = args[++index];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing ${key} value`);
    values[key] = value;
  }
  const config = z
    .object({
      AI_PROVIDER: z.enum(['openai', 'openrouter']),
      AI_MODEL: z.string().trim().min(1),
      AI_API_KEY: z.string().trim().min(1)
    })
    .parse(environment);
  const count = Number(values['--count'] ?? 20);
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new Error('count must be an integer from 1 to 50');
  const concurrency = Number(values['--concurrency'] ?? 3);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3)
    throw new Error('concurrency must be an integer from 1 to 3');
  return {
    provider: config.AI_PROVIDER,
    model: config.AI_MODEL,
    apiKey: config.AI_API_KEY,
    count,
    concurrency,
    minimumPassRate: 0.95
  };
}

export async function runLiveAgentEvaluation(
  options: LiveEvaluationOptions,
  dependencies: {
    provider?: StructuredDecisionProvider;
    fetch?: typeof fetch;
  } = {}
) {
  const tokenUsage = { input: 0, output: 0, known: false };
  const fetcher: typeof fetch = async (...args) => {
    const response = await (dependencies.fetch ?? fetch)(...args);
    try {
      const payload: unknown = await response.clone().json();
      const usage = z
        .object({
          usage: z.object({
            input_tokens: z.number().int().nonnegative().optional(),
            output_tokens: z.number().int().nonnegative().optional(),
            prompt_tokens: z.number().int().nonnegative().optional(),
            completion_tokens: z.number().int().nonnegative().optional()
          })
        })
        .safeParse(payload);
      if (usage.success) {
        tokenUsage.known = true;
        tokenUsage.input +=
          usage.data.usage.input_tokens ?? usage.data.usage.prompt_tokens ?? 0;
        tokenUsage.output +=
          usage.data.usage.output_tokens ??
          usage.data.usage.completion_tokens ??
          0;
      }
    } catch {
      /* Usage is optional; never print raw responses. */
    }
    return response;
  };
  const provider =
    dependencies.provider ??
    createOpenAiDecisionProvider({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl:
        options.provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : 'https://api.openai.com/v1',
      fetch: fetcher
    });
  const scenarios = goldenScenarios
    .filter(
      (scenario) =>
        scenario.turns.length === 1 &&
        scenario.turns.every((turn) =>
          turn.decisions.every((value) => {
            const candidate = z
              .object({ type: z.string(), name: z.string().optional() })
              .safeParse(value);
            return (
              candidate.success &&
              (candidate.data.type !== 'tool' ||
                candidate.data.name?.startsWith('catalog.') === true ||
                candidate.data.name === 'knowledge.search')
            );
          })
        ) &&
        scenario.expected.calls.every(
          (call) =>
            call.name.startsWith('catalog.') || call.name === 'knowledge.search'
        ) &&
        !scenario.turns.some((turn) => turn.after)
    )
    .slice(0, options.count)
    .map((scenario) => ({
      ...scenario,
      allowedCalls: scenario.allowedCalls.filter(
        (name) => name.startsWith('catalog.') || name === 'knowledge.search'
      )
    }));
  if (scenarios.length !== options.count)
    throw new Error(
      'Not enough non-mutating offline fixtures for the requested count'
    );
  const results: GoldenScenarioResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, scenarios.length) },
      async () => {
        while (next < scenarios.length) {
          const scenario = scenarios[next++];
          if (scenario)
            results.push(await runGoldenScenario(scenario, { provider }));
        }
      }
    )
  );
  results.sort((a, b) => a.id.localeCompare(b.id));
  const passRate =
    results.filter((result) => result.passed).length / results.length;
  return {
    model: options.model,
    provider: options.provider,
    scenarioCount: results.length,
    passRate,
    minimumPassRate: options.minimumPassRate,
    passed: passRate >= options.minimumPassRate,
    tokenUsage,
    results
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = parseLiveEvaluationOptions(
      process.argv.slice(2),
      process.env
    );
    const report = await runLiveAgentEvaluation(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  } catch {
    process.stderr.write(
      'Live evaluation did not run successfully. Check explicit --live, provider credentials, count and concurrency.\n'
    );
    process.exitCode = 1;
  }
}
