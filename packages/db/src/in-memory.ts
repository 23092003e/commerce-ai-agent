import { randomUUID } from 'node:crypto';
import type {
  CommerceRepository,
  ConversationLeaseContext,
  ConversationView,
  PersistInboundMessageInput,
  PersistInboundMessageResult,
  RepositorySnapshot,
  StoredWebhookEvent,
  StoreWebhookEventInput,
  UpdateConversationControlModeInput,
  UpdateConversationControlModeResult,
  WebhookEventClaimResult
} from './types.js';

export class InMemoryCommerceRepository implements CommerceRepository {
  async ensureInboundMessage(input: PersistInboundMessageInput): Promise<{
    messageId: string;
    customerId: string;
    conversation: ConversationView;
    inserted: boolean;
  }> {
    const inserted = !this.messages.has(input.metaMessageId);
    const result = await this.persistInboundMessage(input);
    if (result.type !== 'persisted') throw new Error('Inbound event not found');
    return {
      messageId: result.messageId,
      customerId: result.customerId,
      conversation: result.conversation,
      inserted
    };
  }
  private readonly leases = new Map<string, Promise<void>>();

  async withConversationLease<T>(
    key: string,
    operation: (lease: ConversationLeaseContext) => Promise<T>
  ): Promise<T> {
    const previous = this.leases.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.leases.set(key, current);
    await previous;
    try {
      return await operation({ conversationKey: key, token: Symbol(key) });
    } finally {
      release();
      if (this.leases.get(key) === current) this.leases.delete(key);
    }
  }

  async markWebhookEventProcessed(eventKey: string): Promise<void> {
    const event = this.events.get(eventKey);
    if (
      event &&
      !['processed', 'ignored', 'failed'].includes(event.processingState)
    )
      event.processingState = 'processed';
  }

  async markWebhookEventQueuedForRetry(eventKey: string): Promise<void> {
    await this.markWebhookEventQueued(eventKey);
  }

  private readonly events = new Map<string, StoredWebhookEvent>();
  private readonly pages = new Map<
    string,
    { id: string; metaPageId: string }
  >();
  private readonly customers = new Map<
    string,
    { id: string; pageId: string; metaPsid: string }
  >();
  private readonly conversations = new Map<
    string,
    ConversationView & { status: 'open' }
  >();
  private readonly messages = new Map<
    string,
    {
      id: string;
      conversationId: string;
      metaMessageId: string;
      direction: 'inbound';
      senderType: 'customer';
      text: string;
    }
  >();

  async storeWebhookEvent(
    input: StoreWebhookEventInput
  ): Promise<StoredWebhookEvent> {
    const existing = this.events.get(input.externalEventKey);
    if (existing) return structuredClone(existing);

    const event: StoredWebhookEvent = {
      ...structuredClone(input),
      processingState: 'received',
      attempts: 0
    };
    this.events.set(input.externalEventKey, event);
    return structuredClone(event);
  }

  async markWebhookEventQueued(eventKey: string): Promise<void> {
    const event = this.events.get(eventKey);
    if (
      event &&
      !['processed', 'ignored', 'failed'].includes(event.processingState)
    ) {
      event.processingState = 'queued';
    }
  }

  async getWebhookEvent(eventKey: string): Promise<StoredWebhookEvent | null> {
    const event = this.events.get(eventKey);
    return event ? structuredClone(event) : null;
  }

  async claimWebhookEventForProcessing(
    eventKey: string
  ): Promise<WebhookEventClaimResult> {
    const event = this.events.get(eventKey);
    if (!event) return { type: 'not_found' };
    if (
      event.processingState === 'processed' ||
      event.processingState === 'ignored' ||
      event.processingState === 'failed'
    ) {
      return { type: 'terminal' };
    }

    if (event.conversationKey) {
      const hasEarlierPendingEvent = [...this.events.values()].some(
        (candidate) =>
          candidate.externalEventKey !== event.externalEventKey &&
          candidate.conversationKey === event.conversationKey &&
          ['received', 'queued', 'processing'].includes(
            candidate.processingState
          ) &&
          (candidate.eventTimestamp < event.eventTimestamp ||
            (candidate.eventTimestamp === event.eventTimestamp &&
              candidate.externalEventKey < event.externalEventKey))
      );
      if (hasEarlierPendingEvent) return { type: 'deferred' };
    }

    event.processingState = 'processing';
    event.attempts += 1;
    return { type: 'claimed', event: structuredClone(event) };
  }

  async persistInboundMessage(
    input: PersistInboundMessageInput
  ): Promise<PersistInboundMessageResult> {
    const event = this.events.get(input.eventKey);
    if (!event) {
      return { type: 'duplicate' };
    }

    let page = this.pages.get(input.metaPageId);
    if (!page) {
      page = { id: randomUUID(), metaPageId: input.metaPageId };
      this.pages.set(input.metaPageId, page);
    }

    const customerKey = `${page.id}:${input.metaPsid}`;
    let customer = this.customers.get(customerKey);
    if (!customer) {
      customer = {
        id: randomUUID(),
        pageId: page.id,
        metaPsid: input.metaPsid
      };
      this.customers.set(customerKey, customer);
    }

    const conversationKey = `${page.id}:${customer.id}`;
    let conversation = this.conversations.get(conversationKey);
    if (!conversation) {
      conversation = {
        id: randomUUID(),
        pageId: page.id,
        customerId: customer.id,
        status: 'open',
        controlMode: 'ai',
        version: 1
      };
      this.conversations.set(conversationKey, conversation);
    }

    const inserted = !this.messages.has(input.metaMessageId);
    let messageId: string | null = null;
    if (inserted) {
      messageId = randomUUID();
      this.messages.set(input.metaMessageId, {
        id: messageId,
        conversationId: conversation.id,
        metaMessageId: input.metaMessageId,
        direction: 'inbound',
        senderType: 'customer',
        text: input.text
      });
      conversation.version += 1;
    }

    messageId ??= this.messages.get(input.metaMessageId)?.id ?? null;
    return messageId
      ? {
          type: 'persisted',
          messageId,
          customerId: customer.id,
          conversation: structuredClone(conversation)
        }
      : { type: 'duplicate' };
  }

  async findOpenConversationByIdentity(
    metaPageId: string,
    metaPsid: string
  ): Promise<ConversationView | null> {
    const page = this.pages.get(metaPageId);
    if (!page) return null;
    const customer = this.customers.get(`${page.id}:${metaPsid}`);
    if (!customer) return null;
    const conversation = this.conversations.get(`${page.id}:${customer.id}`);
    return conversation ? structuredClone(conversation) : null;
  }

  async updateConversationControlMode(
    input: UpdateConversationControlModeInput
  ): Promise<UpdateConversationControlModeResult> {
    const existing = [...this.conversations.values()].find(
      (candidate) => candidate.id === input.conversationId
    );
    if (!existing) return { type: 'not_found' };
    const page = [...this.pages.values()].find(
      (candidate) => candidate.id === existing.pageId
    );
    const customer = [...this.customers.values()].find(
      (candidate) => candidate.id === existing.customerId
    );
    if (!page || !customer) return { type: 'not_found' };
    return this.withConversationLease<UpdateConversationControlModeResult>(
      `meta:${page.metaPageId}:${customer.metaPsid}`,
      async () => {
        const conversation = [...this.conversations.values()].find(
          (candidate) => candidate.id === input.conversationId
        );
        if (!conversation) return { type: 'not_found' };
        if (conversation.version !== input.expectedVersion) {
          return { type: 'conflict', currentVersion: conversation.version };
        }

        conversation.controlMode = input.controlMode;
        conversation.version += 1;
        return { type: 'updated', conversation: structuredClone(conversation) };
      }
    );
  }

  async markWebhookEventIgnored(eventKey: string): Promise<void> {
    const event = this.events.get(eventKey);
    if (event && event.processingState !== 'processed') {
      event.processingState = 'ignored';
    }
  }

  async markWebhookEventFailed(eventKey: string): Promise<void> {
    const event = this.events.get(eventKey);
    if (
      event &&
      event.processingState !== 'processed' &&
      event.processingState !== 'ignored' &&
      event.processingState !== 'failed'
    ) {
      event.processingState = 'failed';
    }
  }

  async ping(): Promise<void> {}
  async close(): Promise<void> {}

  snapshot(): RepositorySnapshot {
    return structuredClone({
      pages: [...this.pages.values()],
      customers: [...this.customers.values()],
      conversations: [...this.conversations.values()],
      messages: [...this.messages.values()],
      webhookEvents: [...this.events.values()]
    });
  }
}
