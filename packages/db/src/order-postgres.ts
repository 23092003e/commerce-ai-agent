import type {
  CheckoutSnapshot,
  ConfirmedOrderRepository
} from '@fanpage/domain';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

interface CartLineRow {
  customer_id: string;
  conversation_id: string;
  currency: string;
  version: number;
  product_id: string;
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  quantity: number;
  unit_price: string;
}
export class PostgresOrderRepository implements ConfirmedOrderRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }
  async createConfirmed(
    snapshot: CheckoutSnapshot,
    confirmationId: string
  ): Promise<{ orderId: string; orderNumber: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        confirmationId
      ]);
      const existing = await client.query<{ id: string; order_number: string }>(
        'SELECT id, order_number FROM orders WHERE confirmation_id = $1',
        [confirmationId]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return {
          orderId: existing.rows[0].id,
          orderNumber: existing.rows[0].order_number
        };
      }
      const cart = await client.query<CartLineRow>(
        `SELECT c.customer_id, c.conversation_id, c.currency, c.version, i.product_id, i.variant_id, v.sku,
                p.name AS product_name, v.title AS variant_name, i.quantity, i.unit_price_snapshot AS unit_price
         FROM carts c JOIN cart_items i ON i.cart_id = c.id JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = i.product_id
         WHERE c.id = $1 AND c.status = 'active' FOR UPDATE OF c, i`,
        [snapshot.cartId]
      );
      const first = cart.rows[0];
      if (first?.version !== snapshot.cartVersion)
        throw new Error('Checkout confirmation is stale');
      const subtotal = cart.rows.reduce(
        (sum, line) => sum + Number(line.unit_price) * line.quantity,
        0
      );
      if (
        first.currency !== snapshot.currency ||
        subtotal !== snapshot.subtotal ||
        snapshot.total !==
          subtotal + snapshot.shippingFee - snapshot.discountTotal
      )
        throw new Error('Checkout snapshot does not match current cart');
      for (const line of cart.rows) {
        const reserved = await client.query(
          `UPDATE inventory SET quantity_reserved = quantity_reserved + $2, updated_at = now() WHERE variant_id = $1 AND quantity_available - quantity_reserved >= $2`,
          [line.variant_id, line.quantity]
        );
        if (reserved.rowCount !== 1)
          throw new Error('Inventory is no longer available');
      }
      const orderNumber = `ORD-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const order = await client.query<{ id: string }>(
        `INSERT INTO orders (order_number, confirmation_id, customer_id, conversation_id, recipient_name, phone, address, payment_method, currency, subtotal, shipping_fee, discount_total, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [
          orderNumber,
          confirmationId,
          first.customer_id,
          first.conversation_id,
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
      for (const line of cart.rows)
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, sku_snapshot, product_name_snapshot, variant_name_snapshot, quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            orderId,
            line.product_id,
            line.variant_id,
            line.sku,
            line.product_name,
            line.variant_name,
            line.quantity,
            Number(line.unit_price),
            Number(line.unit_price) * line.quantity
          ]
        );
      await client.query(
        `UPDATE carts SET status = 'converted', updated_at = now() WHERE id = $1`,
        [snapshot.cartId]
      );
      await client.query('COMMIT');
      return { orderId, orderNumber };
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
