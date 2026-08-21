import { DelayedError, Worker } from 'bullmq';
import { Redis } from 'ioredis';

export type EventJobResult =
  { type: 'completed' } | { type: 'deferred'; delayMs: number };

export interface EventJobHandler {
  process(eventKey: string): Promise<EventJobResult>;
  onFinalFailure?(eventKey: string, error: Error): Promise<void>;
}

export function startBullMqEventWorker(
  redisUrl: string,
  handler: EventJobHandler
): Worker<{ eventKey: string }> {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 5_000
  });
  const worker = new Worker<{ eventKey: string }>(
    'meta-webhook-events',
    async (job, token) => {
      let result: EventJobResult;
      try {
        result = await handler.process(job.data.eventKey);
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error('Unknown worker failure');
        const maxAttempts = job.opts.attempts ?? 1;
        if (job.attemptsMade + 1 >= maxAttempts) {
          await handler.onFinalFailure?.(job.data.eventKey, normalizedError);
        }
        throw error;
      }

      if (result.type === 'deferred') {
        await job.moveToDelayed(Date.now() + result.delayMs, token);
        throw new DelayedError();
      }
    },
    { connection, concurrency: 10 }
  );

  worker.on('failed', (job, error) => {
    if (!job || !handler.onFinalFailure) return;
    void job
      .getState()
      .then(async (state) => {
        if (state === 'failed') {
          await handler.onFinalFailure?.(job.data.eventKey, error);
        }
      })
      .catch((finalizationError: unknown) => {
        worker.emit(
          'error',
          finalizationError instanceof Error
            ? finalizationError
            : new Error('Failed to finalize terminal event state')
        );
      });
  });

  worker.on('closed', () => connection.disconnect());
  return worker;
}
