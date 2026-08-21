import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

export interface EventJobHandler {
  process(eventKey: string): Promise<void>;
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
    async (job) => handler.process(job.data.eventKey),
    { connection, concurrency: 10 }
  );

  worker.on('closed', () => connection.disconnect());
  return worker;
}
