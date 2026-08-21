export type WebhookProcessingState =
  'received' | 'queued' | 'processing' | 'processed' | 'failed' | 'ignored';

export interface StoredWebhookEvent {
  externalEventKey: string;
  metaPageId: string;
  conversationKey: string | null;
  rawPayload: unknown;
  eventTimestamp: number;
  processingState: WebhookProcessingState;
  attempts: number;
}

export interface StoreWebhookEventInput {
  externalEventKey: string;
  metaPageId: string;
  conversationKey: string;
  rawPayload: unknown;
  eventTimestamp: number;
}

export type ConversationControlMode = 'ai' | 'human' | 'paused';

export interface ConversationView {
  id: string;
  pageId: string;
  customerId: string;
  status: 'open' | 'closed';
  controlMode: ConversationControlMode;
  version: number;
}

export interface UpdateConversationControlModeInput {
  conversationId: string;
  expectedVersion: number;
  controlMode: ConversationControlMode;
}

export type UpdateConversationControlModeResult =
  | { type: 'updated'; conversation: ConversationView }
  | { type: 'conflict'; currentVersion: number }
  | { type: 'not_found' };

export type WebhookEventClaimResult =
  | { type: 'claimed'; event: StoredWebhookEvent }
  | { type: 'deferred' }
  | { type: 'terminal' }
  | { type: 'not_found' };

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
  claimWebhookEventForProcessing(
    eventKey: string
  ): Promise<WebhookEventClaimResult>;
  persistInboundMessage(input: PersistInboundMessageInput): Promise<boolean>;
  findOpenConversationByIdentity(
    metaPageId: string,
    metaPsid: string
  ): Promise<ConversationView | null>;
  updateConversationControlMode(
    input: UpdateConversationControlModeInput
  ): Promise<UpdateConversationControlModeResult>;
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
    controlMode: ConversationControlMode;
    version: number;
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
