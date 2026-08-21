export type WebhookProcessingState =
  'received' | 'queued' | 'processing' | 'processed' | 'failed' | 'ignored';

export interface StoredWebhookEvent {
  externalEventKey: string;
  metaPageId: string;
  rawPayload: unknown;
  eventTimestamp: number;
  processingState: WebhookProcessingState;
  attempts: number;
}

export interface StoreWebhookEventInput {
  externalEventKey: string;
  metaPageId: string;
  rawPayload: unknown;
  eventTimestamp: number;
}

export interface PersistInboundMessageInput {
  eventKey: string;
  metaPageId: string;
  metaPsid: string;
  metaMessageId: string;
  text: string;
  timestamp: number;
  payload: unknown;
}

export interface CommerceRepository {
  storeWebhookEvent(input: StoreWebhookEventInput): Promise<StoredWebhookEvent>;
  markWebhookEventQueued(eventKey: string): Promise<void>;
  getWebhookEvent(eventKey: string): Promise<StoredWebhookEvent | null>;
  persistInboundMessage(input: PersistInboundMessageInput): Promise<boolean>;
  markWebhookEventIgnored(eventKey: string): Promise<void>;
  markWebhookEventFailed(eventKey: string, error: string): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface RepositorySnapshot {
  pages: Array<{ id: string; metaPageId: string }>;
  customers: Array<{ id: string; pageId: string; metaPsid: string }>;
  conversations: Array<{
    id: string;
    pageId: string;
    customerId: string;
    status: 'open';
  }>;
  messages: Array<{
    id: string;
    conversationId: string;
    metaMessageId: string;
    direction: 'inbound';
    senderType: 'customer';
    text: string;
  }>;
  webhookEvents: StoredWebhookEvent[];
}
