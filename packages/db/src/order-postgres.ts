import {
  CheckoutConfirmationError,
  PreparedCheckoutSnapshotSchema,
  type PreparedCheckoutSnapshot,
  type ConfirmedOrderRepository
} from '@fanpage/domain';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Pool } from 'pg';

interface CurrentLine {
  product_id: string;
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  quantity: number;
  price: string;
  product_status: string;
  variant_status: string;
  currency: string;
  available: number;
}

export class PostgresOrderRepository implements ConfirmedOrderRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async createConfirmed(
    value: PreparedCheckoutSnapshot,
    confirmationId: string,
    confirmationMessageTimestamp: number
  ): Promise<{ orderId: string; orderNumber: string; replayed?: boolean }> {
    const snapshot = PreparedCheckoutSnapshotSchema.parse(value);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        snapshot.conversationId
      ]);
      const conversation = await client.query<{
        customer_id: string;
        checkout_state: string;
      }>(
        'SELECT customer_id,checkout_state FROM conversations WHERE id=$1 FOR UPDATE',
        [snapshot.conversationId]
      );
      const owner = conversation.rows[0];
      if (!owner) throw new CheckoutConfirmationError('confirmation_stale');
      const existing = await client.query<{ id: string; order_number: string }>(
        'SELECT id,order_number FROM orders WHERE confirmation_id=$1 AND conversation_id=$2',
        [confirmationId, snapshot.conversationId]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return {
          orderId: existing.rows[0].id,
          orderNumber: existing.rows[0].order_number,
          replayed: true
        };
      }
      const draftResult = await client.query<{
        confirmation_id: string | null;
        confirmation_snapshot: unknown;
        confirmation_consumed_at: Date | null;
        confirmation_expires_at: Date | null;
        recipient_name: string;
        phone: string;
        address: unknown;
        payment_method: string;
      }>('SELECT * FROM checkout_drafts WHERE conversation_id=$1 FOR UPDATE', [
        snapshot.conversationId
      ]);
      const draft = draftResult.rows[0];
      if (
        draft?.confirmation_id !== confirmationId ||
        !draft.confirmation_snapshot
      )
        throw new CheckoutConfirmationError('confirmation_stale');
      if (draft.confirmation_consumed_at)
        throw new CheckoutConfirmationError('confirmation_consumed');
      const summary = await client.query(
        `SELECT id FROM messages WHERE conversation_id=$1 AND direction='outbound' AND payload->>'checkout_confirmation_id'=$2 AND delivery_state IN ('sent','delivered') AND sent_at IS NOT NULL AND sent_at >= to_timestamp($3::double precision / 1000.0) AND sent_at <= to_timestamp($4::double precision / 1000.0) FOR SHARE`,
        [
          snapshot.conversationId,
          confirmationId,
          snapshot.preparedAt,
          confirmationMessageTimestamp
        ]
      );
      if (!summary.rowCount)
        throw new CheckoutConfirmationError('confirmation_stale');
      const stored = PreparedCheckoutSnapshotSchema.parse(
        draft.confirmation_snapshot
      );
      if (
        !isDeepStrictEqual(stored, snapshot) ||
        owner.checkout_state !== 'awaiting_confirmation' ||
        draft.recipient_name !== snapshot.recipientName ||
        draft.phone !== snapshot.phone ||
        draft.payment_method !== snapshot.paymentMethod ||
        !isDeepStrictEqual(draft.address, snapshot.address)
      )
        throw new CheckoutConfirmationError('confirmation_stale');
      const cartResult = await client.query<{
        customer_id: string;
        version: number;
        currency: string;
      }>(
        `SELECT customer_id,version,currency FROM carts WHERE id=$1 AND conversation_id=$2 AND status='active' FOR UPDATE`,
        [snapshot.cartId, snapshot.conversationId]
      );
      const cart = cartResult.rows[0];
      if (
        cart?.customer_id !== owner.customer_id ||
        cart.version !== snapshot.cartVersion ||
        cart.currency !== snapshot.currency
      )
        throw new CheckoutConfirmationError('confirmation_stale');
      const current = await client.query<CurrentLine>(
        `SELECT i.product_id,i.variant_id,v.sku,p.name AS product_name,v.title AS variant_name,i.quantity,v.price,
          p.status AS product_status,v.status AS variant_status,p.currency,stock.quantity_available-stock.quantity_reserved AS available
        FROM cart_items i JOIN product_variants v ON v.id=i.variant_id JOIN products p ON p.id=v.product_id JOIN inventory stock ON stock.variant_id=v.id
        WHERE i.cart_id=$1 ORDER BY i.variant_id FOR UPDATE OF i,v,p,stock`,
        [snapshot.cartId]
      );
      if (current.rows.length !== snapshot.lines.length)
        throw new CheckoutConfirmationError('confirmation_stale');
      for (let index = 0; index < current.rows.length; index++) {
        const line = current.rows[index];
        const expected = snapshot.lines[index];
        if (
          !line ||
          !expected ||
          line.product_status !== 'active' ||
          line.variant_status !== 'active' ||
          line.currency !== snapshot.currency ||
          line.product_id !== expected.productId ||
          line.variant_id !== expected.variantId ||
          line.sku !== expected.sku ||
          line.product_name !== expected.productName ||
          line.variant_name !== expected.variantName ||
          line.quantity !== expected.quantity ||
          Number(line.price) !== expected.unitPrice
        )
          throw new CheckoutConfirmationError('confirmation_stale');
        if (line.available < line.quantity)
          throw new CheckoutConfirmationError('inventory_unavailable');
      }
      const clock = await client.query<{ now: Date }>(
        'SELECT clock_timestamp() AS now'
      );
      const timestamp = clock.rows[0]?.now.getTime();
      if (
        timestamp === undefined ||
        timestamp >= snapshot.expiresAt ||
        !draft.confirmation_expires_at ||
        timestamp >= draft.confirmation_expires_at.getTime()
      )
        throw new CheckoutConfirmationError('confirmation_expired');
      if (timestamp < snapshot.preparedAt)
        throw new CheckoutConfirmationError('confirmation_stale');
      const orderNumber = `ORD-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const order = await client.query<{ id: string }>(
        `INSERT INTO orders (order_number,confirmation_id,customer_id,conversation_id,status,recipient_name,phone,address,payment_method,currency,subtotal,shipping_fee,discount_total,total)
        VALUES ($1,$2,$3,$4,'confirmed',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          orderNumber,
          confirmationId,
          owner.customer_id,
          snapshot.conversationId,
          snapshot.recipientName,
          snapshot.phone,
          snapshot.address,
          snapshot.paymentMethod,
          snapshot.currency,
          snapshot.subtotal,
          snapshot.shippingFee,
          snapshot.discountTotal,
          snapshot.total
        ]
      );
      const orderId = order.rows[0]?.id;
      if (!orderId) throw new Error('Order was not created');
      for (const line of snapshot.lines) {
        const reserved = await client.query(
          `UPDATE inventory SET quantity_reserved=quantity_reserved+$2,updated_at=now() WHERE variant_id=$1 AND quantity_available-quantity_reserved >= $2`,
          [line.variantId, line.quantity]
        );
        if (reserved.rowCount !== 1)
          throw new CheckoutConfirmationError('inventory_unavailable');
        await client.query(
          `INSERT INTO order_items (order_id,product_id,variant_id,sku_snapshot,product_name_snapshot,variant_name_snapshot,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            orderId,
            line.productId,
            line.variantId,
            line.sku,
            line.productName,
            line.variantName,
            line.quantity,
            line.unitPrice,
            line.lineTotal
          ]
        );
      }
      await client.query(
        `UPDATE carts SET status='converted',updated_at=now() WHERE id=$1`,
        [snapshot.cartId]
      );
      await client.query(
        `UPDATE checkout_drafts SET confirmation_consumed_at=clock_timestamp(),recipient_name=NULL,phone=NULL,address=NULL,payment_method=NULL,updated_at=now() WHERE conversation_id=$1`,
        [snapshot.conversationId]
      );
      await client.query(
        `UPDATE conversations SET checkout_state='none',version=version+1,updated_at=now() WHERE id=$1`,
        [snapshot.conversationId]
      );
      await client.query('COMMIT');
      return { orderId, orderNumber, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
