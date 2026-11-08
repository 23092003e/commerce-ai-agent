export interface QueueRecoveryDependencies {
  listPending(): Promise<string[]>;
  enqueue(key: string): Promise<void>;
}

export async function recoverPendingEvents(
  dependencies: QueueRecoveryDependencies
) {
  const keys = await dependencies.listPending();
  let enqueued = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      await dependencies.enqueue(key);
      enqueued++;
    } catch {
      failed++;
    }
  }
  return { examined: keys.length, enqueued, failed };
}

export function startQueueRecovery(
  input: QueueRecoveryDependencies & {
    intervalMs?: number;
    onError(): void;
  }
) {
  const intervalMs = input.intervalMs ?? 30_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  const tick = () => {
    inFlight = recoverPendingEvents(input)
      .then((result) => {
        if (result.failed) input.onError();
      })
      .catch(() => input.onError())
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}
