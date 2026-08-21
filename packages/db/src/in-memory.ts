import { randomUUID } from 'node:crypto';
import type {
  CommerceRepository,
  PersistInboundMessageInput,
  RepositorySnapshot,
  StoredWebhookEvent,
  StoreWebhookEventInput
} from './types.js';

export class InMemoryCommerceRepository implements CommerceRepository {
  private readonly events = new Map<string, StoredWebhookEvent>();
  private readonly pages = new Map<string, { id: string; metaPageId: string }>();
  private readonly customers = new Map<
    string,
    { id: string; pageId: string; metaPsid: string }
  >();
  private readonly conversations = new Map<
    string,
    { id: string; pageId: string; customerId: string; status: 'open' }
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
    if (event && event.processingState !== 'processed') {
      event.processingState = 'queued';
    }
  }

  async getWebhookEvent(eventKey: string): Promise<StoredWebhookEvent | null> {
    const event = this.events.get(eventKey);
    return event ? structuredClone(event) : null;
  }

  async persistInboundMessage(
    input: PersistInboundMessageInput
  ): Promise<boolean> {
    const event = this.events.get(input.eventKey);
    if (!event || event.processingState === 'processed') return false;

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
        status: 'open'
      };
      this.conversations.set(conversationKey, conversation);
    }

    const inserted = !this.messages.has(input.metaMessageId);
    if (inserted) {
      this.messages.set(input.metaMessageId, {
        id: randomUUID(),
        conversationId: conversation.id,
        metaMessageId: input.metaMessageId,
        direction: 'inbound',
        senderType: 'customer',
        text: input.text
      });
    }

    event.processingState = 'processed';
    event.attempts += 1;
    return inserted;
  }

  async markWebhookEventIgnored(eventKey: string): Promise<void> {
    const event = this.events.get(eventKey);
    if (event && event.processingState !== 'processed') {
      event.processingState = 'ignored';
      event.attempts += 1;
    }
  }

  async markWebhookEventFailed(eventKey: string): Promise<void> {
    const event = this.events.get(eventKey);
    if (event && event.processingState !== 'processed') {
      event.processingState = 'failed';
      event.attempts += 1;
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
