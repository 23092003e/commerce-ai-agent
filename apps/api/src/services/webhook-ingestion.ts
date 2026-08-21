import type { CommerceRepository } from '@fanpage/db';
import {
  extractMetaWebhookEvents,
  type MetaWebhookPayload
} from '@fanpage/meta';
import type { EventJobQueue } from '@fanpage/queue';

export interface WebhookIngestion {
  ingest(payload: MetaWebhookPayload): Promise<number>;
}

export function createWebhookIngestionService(dependencies: {
  repository: CommerceRepository;
  queue: EventJobQueue;
}): WebhookIngestion {
  return {
    async ingest(payload) {
      const events = extractMetaWebhookEvents(payload);

      for (const event of events) {
        const stored = await dependencies.repository.storeWebhookEvent(event);
        if (
          stored.processingState !== 'processed' &&
          stored.processingState !== 'ignored'
        ) {
          await dependencies.queue.enqueue(event.externalEventKey);
          await dependencies.repository.markWebhookEventQueued(
            event.externalEventKey
          );
        }
      }

      return events.length;
    }
  };
}
