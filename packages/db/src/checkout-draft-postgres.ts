import {
  CheckoutConfirmationError,
  CheckoutDraftSchema,
  createPreparedCheckoutConfirmation,
  renderPreparedCheckoutConfirmation,
  PreparedCheckoutSnapshotSchema,
  type PreparedCheckoutConfirmation,
  type CheckoutConfirmationRepository,
  type CheckoutDraftRepository
} from '@fanpage/domain';
import { Pool } from 'pg';

interface DraftRow {
  conversation_id: string;
  version: number;
  checkout_state: string;
  recipient_name: string | null;
  phone: string | null;
  address: unknown;
  payment_method: string | null;
}

function asDraft(row: DraftRow) {
  return CheckoutDraftSchema.parse({
    conversationId: row.conversation_id,
    version: row.version,
    state: row.checkout_state,
    recipientName: row.recipient_name,
    phone: row.phone,
    address: row.address,
    paymentMethod: row.payment_method
  });
}

export class PostgresCheckoutDraftRepository
  implements CheckoutDraftRepository, CheckoutConfirmationRepository
{
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async linkSummary(input: {
    conversationId: string;
    confirmationId: string;
    messageId: string;
    text: string;
  }): Promise<void> {
    const prepared = await this.getPrepared(input.conversationId);
    if (
      prepared?.confirmationId !== input.confirmationId ||
      renderPreparedCheckoutConfirmation(prepared) !== input.text
    ) {
      throw new CheckoutConfirmationError('confirmation_stale');
    }
    const result = await this.pool.query(
      `UPDATE messages m SET payload=jsonb_set(m.payload,'{checkout_confirmation_id}',to_jsonb($2::text))
       FROM checkout_drafts d
       WHERE m.id=$3 AND m.conversation_id=$1 AND m.direction='outbound' AND m.text=$4
         AND m.created_at >= d.confirmation_prepared_at AND d.conversation_id=$1
         AND d.confirmation_id=$2 AND d.confirmation_consumed_at IS NULL
         AND d.confirmation_snapshot=$5::jsonb
         AND m.delivery_state IN ('queued','sending','retryable','sent','delivered','unknown','failed')
       RETURNING m.id`,
      [
        input.conversationId,
        input.confirmationId,
        input.messageId,
        input.text,
        JSON.stringify(prepared.snapshot)
      ]
    );
    if (!result.rowCount)
      throw new CheckoutConfirmationError('confirmation_stale');
  }

  async get(conversationId: string) {
    const result = await this.pool.query<DraftRow>(
      `SELECT c.id AS conversation_id, c.version, c.checkout_state,
              d.recipient_name, d.phone, d.address, d.payment_method
       FROM conversations c
       LEFT JOIN checkout_drafts d ON d.conversation_id = c.id
       WHERE c.id = $1`,
      [conversationId]
    );
    const row = result.rows[0];
    return row ? asDraft(row) : null;
  }

  async update(input: Parameters<CheckoutDraftRepository['update']>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.conversationId
      ]);
      const conversation = await client.query<{ version: number }>(
        `UPDATE conversations
         SET checkout_state = $3, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $2
         RETURNING version`,
        [input.conversationId, input.expectedVersion, input.state]
      );
      if (!conversation.rows[0]) throw new Error('Checkout version conflict');
      await client.query(
        `INSERT INTO checkout_drafts (
           conversation_id, recipient_name, phone, address, payment_method
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (conversation_id) DO UPDATE SET
           recipient_name = COALESCE(EXCLUDED.recipient_name, checkout_drafts.recipient_name),
           phone = COALESCE(EXCLUDED.phone, checkout_drafts.phone),
           address = COALESCE(EXCLUDED.address, checkout_drafts.address),
           payment_method = COALESCE(EXCLUDED.payment_method, checkout_drafts.payment_method),
           confirmation_id = NULL,
           confirmation_snapshot = NULL,
           confirmation_prepared_at = NULL,
           confirmation_expires_at = NULL,
           confirmation_consumed_at = NULL,
           confirmation_lines = NULL,
           updated_at = now()`,
        [
          input.conversationId,
          input.recipientName ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.paymentMethod ?? null
        ]
      );
      const result = await client.query<DraftRow>(
        `SELECT c.id AS conversation_id, c.version, c.checkout_state,
                d.recipient_name, d.phone, d.address, d.payment_method
         FROM conversations c
         JOIN checkout_drafts d ON d.conversation_id = c.id
         WHERE c.id = $1`,
        [input.conversationId]
      );
      const row = result.rows[0];
      if (!row) throw new Error('Checkout draft was not persisted');
      await client.query('COMMIT');
      return asDraft(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async prepare(
    input: Parameters<CheckoutConfirmationRepository['prepare']>[0]
  ): Promise<PreparedCheckoutConfirmation> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.conversationId
      ]);
      const result = await client.query<DraftRow>(
        `SELECT c.id AS conversation_id,c.version,c.checkout_state,d.recipient_name,d.phone,d.address,d.payment_method
        FROM conversations c JOIN checkout_drafts d ON d.conversation_id=c.id WHERE c.id=$1 FOR UPDATE OF c,d`,
        [input.conversationId]
      );
      const row = result.rows[0];
      if (!row) throw new Error('Checkout is not ready for confirmation');
      const draft = asDraft(row);
      if (
        draft.state !== 'awaiting_confirmation' ||
        !draft.recipientName ||
        !draft.phone ||
        !draft.address ||
        !draft.paymentMethod
      )
        throw new Error('Checkout is not ready for confirmation');
      const cartResult = await client.query<{
        id: string;
        currency: string;
        version: number;
      }>(
        `SELECT ca.id,ca.currency,ca.version FROM carts ca JOIN conversations c ON c.id=ca.conversation_id
        WHERE ca.conversation_id=$1 AND ca.customer_id=c.customer_id AND ca.status='active' FOR UPDATE OF ca`,
        [input.conversationId]
      );
      const cart = cartResult.rows[0];
      if (!cart) throw new Error('Active checkout cart was not found');
      const items = await client.query<{
        product_id: string;
        variant_id: string;
        sku: string;
        product_name: string;
        variant_name: string;
        quantity: number;
        price: string;
        currency: string;
        product_status: string;
        variant_status: string;
        available: number;
        unit_price_snapshot: string;
      }>(
        `SELECT i.product_id,i.variant_id,v.sku,p.name AS product_name,v.title AS variant_name,i.quantity,v.price,p.currency,p.status AS product_status,v.status AS variant_status,
          stock.quantity_available-stock.quantity_reserved AS available,i.unit_price_snapshot
         FROM cart_items i JOIN product_variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id JOIN inventory stock ON stock.variant_id=v.id
         WHERE i.cart_id=$1 ORDER BY i.variant_id FOR UPDATE OF i,v,p,stock`,
        [cart.id]
      );
      if (!items.rows.length) throw new Error('Checkout cart is empty');
      const lines = [];
      for (const line of items.rows) {
        if (
          line.product_status !== 'active' ||
          line.variant_status !== 'active' ||
          line.available < line.quantity
        )
          throw new CheckoutConfirmationError('inventory_unavailable');
        if (line.currency !== cart.currency)
          throw new Error('cart_currency_mismatch');
        if (line.price !== line.unit_price_snapshot)
          await client.query(
            'UPDATE cart_items SET unit_price_snapshot=$3,updated_at=now() WHERE cart_id=$1 AND variant_id=$2',
            [cart.id, line.variant_id, line.price]
          );
        lines.push({
          productId: line.product_id,
          variantId: line.variant_id,
          sku: line.sku,
          productName: line.product_name,
          variantName: line.variant_name,
          quantity: line.quantity,
          unitPrice: Number(line.price),
          lineTotal: Number(line.price) * line.quantity
        });
      }
      const versionResult = await client.query<{ version: number }>(
        'SELECT version FROM carts WHERE id=$1',
        [cart.id]
      );
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const prepared = createPreparedCheckoutConfirmation(
        input.confirmationSecret,
        {
          conversationId: input.conversationId,
          nonce: input.nonce,
          preparedAt: input.preparedAt,
          expiresAt: input.expiresAt,
          cartId: cart.id,
          cartVersion: versionResult.rows[0]?.version,
          recipientName: draft.recipientName,
          phone: draft.phone,
          address: draft.address,
          paymentMethod: draft.paymentMethod,
          currency: cart.currency,
          subtotal,
          shippingFee: 0,
          discountTotal: 0,
          total: subtotal,
          lines
        }
      );
      await client.query(
        `UPDATE checkout_drafts SET cart_id=$2,cart_version=$3,confirmation_id=$4,confirmation_snapshot=$5,
        confirmation_prepared_at=$6,confirmation_expires_at=$7,confirmation_consumed_at=NULL,confirmation_lines=$8,updated_at=now() WHERE conversation_id=$1`,
        [
          input.conversationId,
          cart.id,
          prepared.snapshot.cartVersion,
          prepared.confirmationId,
          prepared.snapshot,
          new Date(input.preparedAt),
          new Date(input.expiresAt),
          JSON.stringify(lines)
        ]
      );
      await client.query('COMMIT');
      return prepared;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getPrepared(
    conversationId: string
  ): Promise<PreparedCheckoutConfirmation | null> {
    const result = await this.pool.query<{
      confirmation_id: string;
      confirmation_snapshot: unknown;
    }>(
      `SELECT confirmation_id,confirmation_snapshot FROM checkout_drafts WHERE conversation_id=$1 AND confirmation_id IS NOT NULL AND confirmation_consumed_at IS NULL`,
      [conversationId]
    );
    const row = result.rows[0];
    return row
      ? {
          confirmationId: row.confirmation_id,
          snapshot: PreparedCheckoutSnapshotSchema.parse(
            row.confirmation_snapshot
          )
        }
      : null;
  }

  async invalidate(conversationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE checkout_drafts SET confirmation_id=NULL,confirmation_snapshot=NULL,confirmation_prepared_at=NULL,confirmation_expires_at=NULL,confirmation_consumed_at=NULL,confirmation_lines=NULL,updated_at=now() WHERE conversation_id=$1`,
      [conversationId]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
