import { Pool } from 'pg';
import {
  assembleAgentContext,
  ConversationSummarySchema,
  boundRecentMessages,
  redactConversationText,
  type ConversationContextRepository,
  type RecentAgentMessage
} from '@fanpage/domain';
import { z } from 'zod';

/** Read only explicit projections while the worker holds the conversation lease. */
export class PostgresConversationContextRepository implements ConversationContextRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }
  async saveProductReferences(input: {
    conversationId: string;
    turnId: string;
    items: Array<{
      position: number;
      productId: string;
      variantId: string | null;
    }>;
  }) {
    const parsed = z
      .object({
        conversationId: z.uuid(),
        turnId: z.uuid(),
        items: z
          .array(
            z
              .object({
                position: z.number().int().min(1).max(10),
                productId: z.uuid(),
                variantId: z.uuid().nullable()
              })
              .strict()
          )
          .min(1)
          .max(10)
      })
      .strict()
      .parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = (
        await client.query<{ version: number }>(
          'SELECT version FROM conversations WHERE id=$1 FOR UPDATE',
          [parsed.conversationId]
        )
      ).rows[0];
      if (!current) throw new Error('invalid_product_reference');
      for (const [index, item] of parsed.items.entries()) {
        if (item.position !== index + 1)
          throw new Error('invalid_product_reference');
        const active = await client.query(
          `SELECT p.id FROM products p WHERE p.id=$1 AND p.status='active' AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM product_variants v WHERE v.id=$2 AND v.product_id=p.id AND v.status='active'))`,
          [item.productId, item.variantId]
        );
        if (!active.rows[0]) throw new Error('invalid_product_reference');
      }
      await client.query(
        'UPDATE conversations SET current_product_refs=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$2',
        [
          parsed.conversationId,
          current.version,
          JSON.stringify({ turnId: parsed.turnId, items: parsed.items })
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async load(input: Parameters<ConversationContextRepository['load']>[0]) {
    z.object({
      conversationId: z.uuid(),
      recentMessageLimit: z.literal(12),
      recentCharacterBudget: z.literal(4000),
      excludeMessageId: z.uuid().optional()
    })
      .strict()
      .parse(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const conversation = await client.query<{
        control_mode: string;
        last_summary: string | null;
        version: number;
        current_product_refs: unknown;
        checkout_state: string;
      }>(
        'SELECT control_mode,last_summary,version,current_product_refs,checkout_state FROM conversations WHERE id=$1',
        [input.conversationId]
      );
      const row = conversation.rows[0];
      if (!row) throw new Error('Conversation not found');
      const messages = await client.query<{
        direction: RecentAgentMessage['direction'];
        sender_type: RecentAgentMessage['senderType'];
        text: string | null;
        created_at: Date;
      }>(
        `SELECT direction,sender_type,text,created_at FROM messages WHERE conversation_id=$1 AND ($2::uuid IS NULL OR id<>$2) AND (direction='inbound' OR delivery_state IN ('sent','delivered')) ORDER BY created_at DESC,id DESC LIMIT 12`,
        [input.conversationId, input.excludeMessageId ?? null]
      );
      const draft = await client.query<{
        recipient_name: string | null;
        phone: string | null;
        address: unknown;
        payment_method: string | null;
        confirmation_id: string | null;
        confirmation_expires_at: Date | null;
        confirmation_consumed_at: Date | null;
      }>(
        'SELECT recipient_name,phone,address,payment_method,confirmation_id,confirmation_expires_at,confirmation_consumed_at FROM checkout_drafts WHERE conversation_id=$1',
        [input.conversationId]
      );
      const currentDraft = draft.rows[0];
      const privateAddress = z
        .object({ line1: z.string(), ward: z.string(), city: z.string() })
        .safeParse(currentDraft?.address);
      const privateValues = [
        currentDraft?.phone ?? '',
        ...(privateAddress.success ? Object.values(privateAddress.data) : [])
      ];
      let safeSummary: string | undefined;
      if (row.last_summary) {
        try {
          const parsed = ConversationSummarySchema.safeParse(
            JSON.parse(row.last_summary)
          );
          if (parsed.success) safeSummary = JSON.stringify(parsed.data);
        } catch {
          /* Legacy text summaries are redacted below. */
        }
        safeSummary ??= redactConversationText(
          row.last_summary,
          privateValues
        ).slice(0, 2000);
      }
      const cartRows = await client.query<{
        id: string;
        version: number;
        currency: string;
      }>(
        `SELECT id,version,currency FROM carts WHERE conversation_id=$1 AND status='active' ORDER BY updated_at DESC LIMIT 1`,
        [input.conversationId]
      );
      const activeCart = cartRows.rows[0];
      const lines = activeCart
        ? await client.query<{
            variant_id: string;
            title: string;
            quantity: number;
          }>(
            `SELECT i.variant_id,v.title,i.quantity FROM cart_items i JOIN product_variants v ON v.id=i.variant_id WHERE i.cart_id=$1 ORDER BY i.created_at,i.variant_id LIMIT 100`,
            [activeCart.id]
          )
        : null;
      const refs = z
        .object({
          items: z.array(
            z.object({
              position: z.number(),
              productId: z.string(),
              variantId: z.string().nullable()
            })
          )
        })
        .safeParse(row.current_product_refs);
      const missingFields = currentDraft
        ? [
            ['recipientName', currentDraft.recipient_name],
            ['phone', currentDraft.phone],
            ['address', currentDraft.address],
            ['paymentMethod', currentDraft.payment_method]
          ]
            .filter(([, value]) => !value)
            .map(([name]) => name)
        : ['recipientName', 'phone', 'address', 'paymentMethod'];
      const preparedId =
        currentDraft?.confirmation_id &&
        !currentDraft.confirmation_consumed_at &&
        currentDraft.confirmation_expires_at &&
        currentDraft.confirmation_expires_at.getTime() > Date.now()
          ? currentDraft.confirmation_id
          : undefined;
      const context = assembleAgentContext({
        customerMessage: '_',
        controlMode: row.control_mode,
        ...(safeSummary ? { summary: safeSummary } : {}),
        recentMessages: boundRecentMessages(
          messages.rows.reverse().map((item) => ({
            direction: item.direction,
            senderType: item.sender_type,
            text:
              item.direction === 'inbound' && row.checkout_state !== 'none'
                ? '[redacted checkout input]'
                : redactConversationText(item.text ?? '', privateValues),
            createdAt: item.created_at.toISOString()
          }))
        ),
        cart: activeCart
          ? {
              ...activeCart,
              lines:
                lines?.rows.map((item) => ({
                  variantId: item.variant_id,
                  title: item.title,
                  quantity: item.quantity
                })) ?? []
            }
          : null,
        checkout: {
          version: row.version,
          state: row.checkout_state,
          missingFields,
          ...(preparedId ? { preparedConfirmationId: preparedId } : {})
        },
        productReferences: refs.success
          ? refs.data.items.toSorted((a, b) => a.position - b.position)
          : []
      });
      await client.query('COMMIT');
      return {
        controlMode: context.controlMode,
        recentMessages: context.recentMessages,
        cart: context.cart,
        checkout: context.checkout,
        productReferences: context.productReferences,
        ...(context.summary ? { summary: context.summary } : {})
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
