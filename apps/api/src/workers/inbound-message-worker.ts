import type { CommerceRepository, ConversationView } from '@fanpage/db';
import { normalizeInboundTextMessage } from '@fanpage/meta';
import type { EventJobResult } from '@fanpage/queue';

const ORDERING_RETRY_DELAY_MS = 100;

export interface PersistedInboundMessageHandler {
  handle(input: {
    messageId: string;
    customerId: string;
    conversation: ConversationView;
    recipientId: string;
    text: string;
    timestamp: number;
  }): Promise<void>;
}

export class InboundMessageWorker {
  constructor(
    private readonly repository: CommerceRepository,
    private readonly persistedMessageHandler?: PersistedInboundMessageHandler
  ) {}

  async process(eventKey: string): Promise<EventJobResult> {
    const claim =
      await this.repository.claimWebhookEventForProcessing(eventKey);
    if (claim.type === 'not_found' || claim.type === 'terminal') {
      return { type: 'completed' };
    }
    if (claim.type === 'deferred') {
      return { type: 'deferred', delayMs: ORDERING_RETRY_DELAY_MS };
    }
    const { event } = claim;

    const message = normalizeInboundTextMessage(event.rawPayload);
    if (!message) {
      await this.repository.markWebhookEventIgnored(eventKey);
      return { type: 'completed' };
    }

    const persisted = await this.repository.persistInboundMessage({
      eventKey,
      ...message
    });
    if (persisted.type === 'persisted' && this.persistedMessageHandler) {
      await this.persistedMessageHandler.handle({
        messageId: persisted.messageId,
        customerId: persisted.customerId,
        conversation: persisted.conversation,
        recipientId: message.metaPsid,
        text: message.text,
        timestamp: message.timestamp
      });
    }
    return { type: 'completed' };
  }

  async onFinalFailure(eventKey: string, error: Error): Promise<void> {
    await this.repository.markWebhookEventFailed(eventKey, error.message);
  }
}
