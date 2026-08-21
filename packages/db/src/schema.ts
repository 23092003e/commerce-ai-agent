import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const pageStatus = pgEnum('page_status', ['active', 'paused']);
export const conversationStatus = pgEnum('conversation_status', [
  'open',
  'closed'
]);
export const conversationControlMode = pgEnum('conversation_control_mode', [
  'ai',
  'human',
  'paused'
]);
export const checkoutState = pgEnum('checkout_state', [
  'none',
  'collecting_name',
  'collecting_phone',
  'collecting_address',
  'collecting_payment',
  'awaiting_confirmation'
]);
export const messageDirection = pgEnum('message_direction', [
  'inbound',
  'outbound'
]);
export const messageSenderType = pgEnum('message_sender_type', [
  'customer',
  'ai',
  'human',
  'system'
]);
export const messageType = pgEnum('message_type', [
  'text',
  'image',
  'attachment',
  'postback',
  'system'
]);
export const messageDeliveryState = pgEnum('message_delivery_state', [
  'received',
  'queued',
  'sent',
  'delivered',
  'failed'
]);
export const webhookProcessingState = pgEnum('webhook_processing_state', [
  'received',
  'queued',
  'processing',
  'processed',
  'failed',
  'ignored'
]);

export const pages = pgTable('pages', {
  id: uuid().primaryKey().defaultRandom(),
  metaPageId: text('meta_page_id').notNull().unique(),
  name: text().notNull(),
  status: pageStatus().notNull().default('active'),
  timezone: text().notNull().default('UTC'),
  defaultLocale: text('default_locale').notNull().default('vi_VN'),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
});

export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    metaPsid: text('meta_psid').notNull(),
    displayName: text('display_name'),
    phone: text(),
    email: text(),
    locale: text(),
    metadata: jsonb().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [uniqueIndex().on(table.pageId, table.metaPsid)]
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    status: conversationStatus().notNull().default('open'),
    controlMode: conversationControlMode('control_mode')
      .notNull()
      .default('ai'),
    checkoutState: checkoutState('checkout_state').notNull().default('none'),
    activeCartId: uuid('active_cart_id'),
    currentProductRefs: jsonb('current_product_refs').notNull().default([]),
    lastCustomerMessageAt: timestamp('last_customer_message_at', {
      withTimezone: true
    }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastSummary: text('last_summary'),
    summaryUpdatedAt: timestamp('summary_updated_at', { withTimezone: true }),
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('conversations_one_open_per_customer')
      .on(table.pageId, table.customerId)
      .where(sql`${table.status} = 'open'`)
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    metaMessageId: text('meta_message_id'),
    direction: messageDirection().notNull(),
    senderType: messageSenderType('sender_type').notNull(),
    messageType: messageType('message_type').notNull(),
    text: text(),
    payload: jsonb().notNull().default({}),
    metaTimestamp: bigint('meta_timestamp', { mode: 'number' }),
    deliveryState: messageDeliveryState('delivery_state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('messages_meta_message_id_unique')
      .on(table.metaMessageId)
      .where(sql`${table.metaMessageId} IS NOT NULL`)
  ]
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: text().notNull(),
    externalEventKey: text('external_event_key').notNull().unique(),
    pageId: uuid('page_id').references(() => pages.id),
    providerPageId: text('provider_page_id'),
    conversationKey: text('conversation_key'),
    rawPayload: jsonb('raw_payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    eventTimestamp: bigint('event_timestamp', { mode: 'number' }),
    processingState: webhookProcessingState('processing_state')
      .notNull()
      .default('received'),
    attempts: integer().notNull().default(0),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true })
  },
  (table) => [
    index('webhook_events_processing_state_idx').on(
      table.processingState,
      table.receivedAt
    ),
    index('webhook_events_conversation_order_idx')
      .on(table.conversationKey, table.eventTimestamp, table.externalEventKey)
      .where(
        sql`${table.processingState} IN ('received', 'queued', 'processing')`
      )
  ]
);
