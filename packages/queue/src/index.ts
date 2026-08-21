import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface EventJobQueue {
  enqueue(eventKey: string): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export class InMemoryEventJobQueue implements EventJobQueue {
  private readonly pending: string[] = [];
  private readonly pendingKeys = new Set<string>();

  async enqueue(eventKey: string): Promise<void> {
    if (!this.pendingKeys.has(eventKey)) {
      this.pending.push(eventKey);
      this.pendingKeys.add(eventKey);
    }
  }

  take(): string | undefined {
    const eventKey = this.pending.shift();
    if (eventKey) this.pendingKeys.delete(eventKey);
    return eventKey;
  }

  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

export class BullMqEventJobQueue implements EventJobQueue {
  private readonly connection: Redis;
  private readonly queue: Queue<{ eventKey: string }>;

  constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue('meta-webhook-events', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000
      }
    });
  }

  async enqueue(eventKey: string): Promise<void> {
    const jobId = createHash('sha256').update(eventKey).digest('hex');
    await this.queue.add('process-meta-event', { eventKey }, { jobId });
  }

  async ping(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}

export {
  startBullMqEventWorker,
  type EventJobHandler
} from './worker.js';
