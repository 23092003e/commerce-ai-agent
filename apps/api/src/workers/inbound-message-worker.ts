import type {
  CommerceRepository,
  ConversationView,
  ConversationLeaseContext
} from '@fanpage/db';
import { MetaChannelError, normalizeInboundTextMessage } from '@fanpage/meta';
import type { EventJobResult } from '@fanpage/queue';
import type { OperationalMetrics } from '@fanpage/observability';

const ORDERING_RETRY_DELAY_MS = 100;
export interface AgentHandlingResult {
  outcome: 'replied' | 'handed_over' | 'no_action';
  outboundMessageId?: string;
}

export interface PersistedInboundMessageHandler {
  handle(input: {
    messageId: string;
    customerId: string;
    conversation: ConversationView;
    recipientId: string;
    text: string;
    timestamp: number;
    lease?: ConversationLeaseContext;
  }): Promise<unknown>;
}

export class InboundMessageWorker {
  constructor(
    private readonly repository: CommerceRepository,
    private readonly persistedMessageHandler?: PersistedInboundMessageHandler,
    private readonly handovers?: {
      request(input: {
        conversationId: string;
        expectedVersion: number;
        reason: string;
        lease?: ConversationLeaseContext | undefined;
      }): Promise<unknown>;
    },
    private readonly metrics?: OperationalMetrics
  ) {}

  async process(eventKey: string): Promise<EventJobResult> {
    const startedAt = performance.now();
    let outcome = 'completed';
    try {
      const initial = await this.repository.getWebhookEvent(eventKey);
      if (!initial) return { type: 'completed' };
      return await this.repository
        .withConversationLease<EventJobResult>(
          initial.conversationKey ?? eventKey,
          async (lease) => {
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

            const persisted = await this.repository.ensureInboundMessage({
              eventKey,
              ...message
            });
            if (this.persistedMessageHandler) {
              await this.persistedMessageHandler.handle({
                messageId: persisted.messageId,
                customerId: persisted.customerId,
                conversation: persisted.conversation,
                recipientId: message.metaPsid,
                text: message.text,
                timestamp: message.timestamp,
                lease
              });
            }
            await this.repository.markWebhookEventProcessed(eventKey);
            return { type: 'completed' };
          }
        )
        .catch(async (error: unknown) => {
          outcome = 'failed';
          await this.repository.markWebhookEventQueuedForRetry(
            eventKey,
            'turn_retry'
          );
          throw error;
        });
    } finally {
      this.metrics?.observe(
        'worker_duration_ms',
        Math.round(performance.now() - startedAt),
        { outcome }
      );
    }
  }

  async onFinalFailure(eventKey: string, error: Error): Promise<void> {
    const event = await this.repository.getWebhookEvent(eventKey);
    if (
      !event ||
      ['processed', 'ignored', 'failed'].includes(event.processingState)
    )
      return;
    await this.repository.withConversationLease(
      event.conversationKey ?? eventKey,
      async (lease) => {
        const current = await this.repository.getWebhookEvent(eventKey);
        if (
          !current ||
          ['processed', 'ignored', 'failed'].includes(current.processingState)
        )
          return;
        const message = normalizeInboundTextMessage(current.rawPayload);
        if (message && this.handovers) {
          const conversation =
            await this.repository.findOpenConversationByIdentity(
              message.metaPageId,
              message.metaPsid
            );
          if (conversation)
            await this.handovers.request({
              conversationId: conversation.id,
              expectedVersion: conversation.version,
              reason: 'turn_attempts_exhausted',
              lease
            });
        }
        await this.repository.markWebhookEventFailed(
          eventKey,
          error instanceof MetaChannelError
            ? error.code
            : 'turn_attempts_exhausted'
        );
      }
    );
  }
}
