import type { ActiveCheckoutCart, Cart, CartRepository } from '@fanpage/domain';
import { Pool, type PoolClient } from 'pg';

interface CartRow {
  id: string;
  currency: string;
  product_id: string;
  variant_id: string;
  sku: string;
  title: string;
  quantity: number;
  unit_price_snapshot: string;
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('Invalid cart money');
  return parsed;
}

async function readCart(client: PoolClient, cartId: string): Promise<Cart> {
  const result = await client.query<CartRow>(
    `SELECT c.id, c.currency, i.product_id, i.variant_id, v.sku, v.title, i.quantity, i.unit_price_snapshot
     FROM carts c JOIN cart_items i ON i.cart_id = c.id JOIN product_variants v ON v.id = i.variant_id
     WHERE c.id = $1 ORDER BY i.created_at, i.id`,
    [cartId]
  );
  const first = result.rows[0];
  if (!first) throw new Error('Cart line was not persisted');
  const lines = result.rows.map((row) => {
    const unitPrice = integer(row.unit_price_snapshot);
    return {
      productId: row.product_id,
      variantId: row.variant_id,
      sku: row.sku,
      title: row.title,
      quantity: row.quantity,
      unitPrice,
      lineTotal: unitPrice * row.quantity
    };
  });
  const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);
  return {
    id: first.id,
    currency: first.currency,
    lines,
    subtotal,
    total: subtotal
  };
}

export class PostgresCartRepository implements CartRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async upsertLine(
    input: Parameters<CartRepository['upsertLine']>[0]
  ): Promise<Cart> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.conversationId
      ]);
      let cart = await client.query<{ id: string }>(
        `SELECT id FROM carts WHERE conversation_id = $1 AND status = 'active' FOR UPDATE`,
        [input.conversationId]
      );
      if (!cart.rows[0]) {
        cart = await client.query<{ id: string }>(
          `INSERT INTO carts (customer_id, conversation_id, currency) VALUES ($1, $2, $3) RETURNING id`,
          [input.customerId, input.conversationId, input.currency]
        );
      }
      const cartId = cart.rows[0]?.id;
      if (!cartId) throw new Error('Cart was not created');
      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, unit_price_snapshot)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = EXCLUDED.quantity, unit_price_snapshot = EXCLUDED.unit_price_snapshot, updated_at = now()`,
        [
          cartId,
          input.productId,
          input.variantId,
          input.quantity,
          input.unitPrice
        ]
      );
      const output = await readCart(client, cartId);
      await client.query('COMMIT');
      return output;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async setLineQuantity(input: {
    cartId: string;
    variantId: string;
    quantity: number;
  }): Promise<Cart> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE cart_items i SET quantity = $3, updated_at = now()
         FROM carts c WHERE i.cart_id = c.id AND c.status = 'active'
           AND i.cart_id = $1 AND i.variant_id = $2`,
        [input.cartId, input.variantId, input.quantity]
      );
      if (updated.rowCount !== 1) throw new Error('Cart line was not found');
      const cart = await readCart(client, input.cartId);
      await client.query('COMMIT');
      return cart;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async removeLine(input: {
    cartId: string;
    variantId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM cart_items i USING carts c
       WHERE i.cart_id = c.id AND c.status = 'active'
         AND i.cart_id = $1 AND i.variant_id = $2`,
      [input.cartId, input.variantId]
    );
    if (result.rowCount !== 1) throw new Error('Cart line was not found');
  }
  async getActiveForConversation(
    conversationId: string
  ): Promise<ActiveCheckoutCart | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ id: string; version: number }>(
        `SELECT id, version FROM carts
         WHERE conversation_id = $1 AND status = 'active'
         FOR SHARE`,
        [conversationId]
      );
      const row = result.rows[0];
      if (!row) return null;
      const cart = await readCart(client, row.id);
      return {
        id: cart.id,
        version: row.version,
        currency: cart.currency,
        subtotal: cart.subtotal,
        total: cart.total
      };
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
