export interface LoadSummary {
  count: number;
  succeeded: number;
  failed: number;
  p50Ms: number;
  p95Ms: number;
}

export async function runConcurrentLoad(input: {
  count: number;
  concurrency: number;
  send(index: number): Promise<void>;
}): Promise<LoadSummary> {
  if (
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > 10_000
  ) {
    throw new Error('count must be an integer from 1 to 10000');
  }
  if (
    !Number.isInteger(input.concurrency) ||
    input.concurrency < 1 ||
    input.concurrency > 100
  ) {
    throw new Error('concurrency must be an integer from 1 to 100');
  }

  let nextIndex = 0;
  let succeeded = 0;
  let failed = 0;
  const latencies: number[] = [];
  async function worker(): Promise<void> {
    while (nextIndex < input.count) {
      const index = nextIndex;
      nextIndex += 1;
      const startedAt = performance.now();
      try {
        await input.send(index);
        succeeded += 1;
      } catch {
        failed += 1;
      }
      latencies.push(performance.now() - startedAt);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, input.count) }, worker)
  );
  latencies.sort((left, right) => left - right);
  function percentile(percent: number): number {
    const index = Math.min(
      latencies.length - 1,
      Math.max(0, Math.ceil((percent / 100) * latencies.length) - 1)
    );
    return Math.round((latencies[index] ?? 0) * 100) / 100;
  }
  return {
    count: input.count,
    succeeded,
    failed,
    p50Ms: percentile(50),
    p95Ms: percentile(95)
  };
}
