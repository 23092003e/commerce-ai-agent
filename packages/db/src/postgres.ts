import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import type {
  CommerceRepository,
  PersistInboundMessageInput,
  StoredWebhookEvent,
  StoreWebhookEventInput
} from './types.js';

function mapEvent(
  row: typeof schema.webhookEvents.$inferSelect
): StoredWebhookEvent {
  return {
    externalEventKey: row.externalEventKey,
    metaPageId: row.providerPageId ?? '',
    rawPayload: row.rawPayload,
    eventTimestamp: row.eventTimestamp ?? 0,
    processingState: row.processingState,
    attempts: row.attempts
  };
}

export class PostgresCommerceRepository implements CommerceRepository {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool, { schema });
  }

  async storeWebhookEvent(
    input: StoreWebhookEventInput
  ): Promise<StoredWebhookEvent> {
    const [inserted] = await this.db
      .insert(schema.webhookEvents)
      .values({
        provider: 'meta',
        externalEventKey: input.externalEventKey,
        providerPageId: input.metaPageId,
        rawPayload: input.rawPayload,
        eventTimestamp: input.eventTimestamp
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) return mapEvent(inserted);

    const [existing] = await this.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.externalEventKey, input.externalEventKey))
      .limit(1);

    if (!existing) throw new Error('Webhook event disappeared after conflict');
    return mapEvent(existing);
  }

  async markWebhookEventQueued(eventKey: string): Promise<void> {
    await this.db
      .update(schema.webhookEvents)
      .set({ processingState: 'queued' })
      .where(
        and(
          eq(schema.webhookEvents.externalEventKey, eventKey),
          sql`${schema.webhookEvents.processingState} NOT IN ('processed', 'ignored')`
        )
      );
  }

  async getWebhookEvent(eventKey: string): Promise<StoredWebhookEvent | null> {
    const [event] = await this.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.externalEventKey, eventKey))
      .limit(1);
    return event ? mapEvent(event) : null;
  }

  async persistInboundMessage(
    input: PersistInboundMessageInput
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.metaPageId}:${input.metaPsid}`}, 0))`
      );

      const [event] = await tx
        .select()
        .from(schema.webhookEvents)
        .where(eq(schema.webhookEvents.externalEventKey, input.eventKey))
        .limit(1);
      if (!event || event.processingState === 'processed') return false;

      const now = new Date();
      const messageTime = new Date(input.timestamp);
      const [page] = await tx
        .insert(schema.pages)
        .values({
          metaPageId: input.metaPageId,
          name: `Meta Page ${input.metaPageId}`
        })
        .onConflictDoUpdate({
          target: schema.pages.metaPageId,
          set: { updatedAt: now }
        })
        .returning({ id: schema.pages.id });
      if (!page) throw new Error('Failed to resolve page');

      const [customer] = await tx
        .insert(schema.customers)
        .values({ pageId: page.id, metaPsid: input.metaPsid })
        .onConflictDoUpdate({
          target: [schema.customers.pageId, schema.customers.metaPsid],
          set: { updatedAt: now }
        })
        .returning({ id: schema.customers.id });
      if (!customer) throw new Error('Failed to resolve customer');

      let [conversation] = await tx
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(
          and(
            eq(schema.conversations.pageId, page.id),
            eq(schema.conversations.customerId, customer.id),
            eq(schema.conversations.status, 'open')
          )
        )
        .limit(1);

      if (!conversation) {
        [conversation] = await tx
          .insert(schema.conversations)
          .values({ pageId: page.id, customerId: customer.id })
          .returning({ id: schema.conversations.id });
      }
      if (!conversation) throw new Error('Failed to resolve conversation');

      const inserted = await tx
        .insert(schema.messages)
        .values({
          conversationId: conversation.id,
          metaMessageId: input.metaMessageId,
          direction: 'inbound',
          senderType: 'customer',
          messageType: 'text',
          text: input.text,
          payload: input.payload,
          metaTimestamp: input.timestamp,
          deliveryState: 'received'
        })
        .onConflictDoNothing()
        .returning({ id: schema.messages.id });

      if (inserted.length > 0) {
        await tx
          .update(schema.conversations)
          .set({
            lastCustomerMessageAt: sql`GREATEST(COALESCE(${schema.conversations.lastCustomerMessageAt}, ${messageTime}), ${messageTime})`,
            lastMessageAt: sql`GREATEST(COALESCE(${schema.conversations.lastMessageAt}, ${messageTime}), ${messageTime})`,
            version: sql`${schema.conversations.version} + 1`,
            updatedAt: now
          })
          .where(eq(schema.conversations.id, conversation.id));
      }

      await tx
        .update(schema.webhookEvents)
        .set({
          pageId: page.id,
          processingState: 'processed',
          attempts: sql`${schema.webhookEvents.attempts} + 1`,
          lastError: null,
          processedAt: now
        })
        .where(eq(schema.webhookEvents.externalEventKey, input.eventKey));

      return inserted.length > 0;
    });
  }

  async markWebhookEventIgnored(eventKey: string): Promise<void> {
    await this.updateTerminalEvent(eventKey, 'ignored');
  }

  async markWebhookEventFailed(eventKey: string, error: string): Promise<void> {
    await this.db
      .update(schema.webhookEvents)
      .set({
        processingState: 'failed',
        attempts: sql`${schema.webhookEvents.attempts} + 1`,
        lastError: error.slice(0, 1_000)
      })
      .where(
        and(
          eq(schema.webhookEvents.externalEventKey, eventKey),
          sql`${schema.webhookEvents.processingState} <> 'processed'`
        )
      );
  }

  private async updateTerminalEvent(
    eventKey: string,
    state: 'ignored'
  ): Promise<void> {
    await this.db
      .update(schema.webhookEvents)
      .set({
        processingState: state,
        attempts: sql`${schema.webhookEvents.attempts} + 1`,
        processedAt: new Date()
      })
      .where(
        and(
          eq(schema.webhookEvents.externalEventKey, eventKey),
          sql`${schema.webhookEvents.processingState} <> 'processed'`
        )
      );
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`SELECT 1`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
