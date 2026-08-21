import type { CommerceRepository } from '@fanpage/db';
import { normalizeInboundTextMessage } from '@fanpage/meta';

export class InboundMessageWorker {
  constructor(private readonly repository: CommerceRepository) {}

  async process(eventKey: string): Promise<void> {
    const event = await this.repository.getWebhookEvent(eventKey);
    if (!event || event.processingState === 'processed') return;

    const message = normalizeInboundTextMessage(event.rawPayload);
    if (!message) {
      await this.repository.markWebhookEventIgnored(eventKey);
      return;
    }

    try {
      await this.repository.persistInboundMessage({
        eventKey,
        ...message
      });
    } catch (error) {
      await this.repository.markWebhookEventFailed(
        eventKey,
        error instanceof Error ? error.message : 'Unknown worker failure'
      );
      throw error;
    }
  }
}
