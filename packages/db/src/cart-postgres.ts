import type { ActiveCheckoutCart, Cart, CartRepository } from '@fanpage/domain';
import { Pool, type PoolClient } from 'pg';
import { CheckoutConfirmationError } from '@fanpage/domain';

function integer(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('Invalid cart money');
  return parsed;
}

async function readCart(client: PoolClient, cartId: string): Promise<Cart> {
  const cart = await client.query<{ id: string; currency: string }>(
    'SELECT id,currency FROM carts WHERE id=$1',
    [cartId]
  );
  const first = cart.rows[0];
  if (!first) throw new Error('Cart was not found');
  const result = await client.query<{
    product_id: string;
    variant_id: string;
    sku: string;
    title: string;
    quantity: number;
    unit_price_snapshot: string;
  }>(
    `SELECT i.product_id,i.variant_id,v.sku,v.title,i.quantity,i.unit_price_snapshot FROM cart_items i
     JOIN product_variants v ON v.id=i.variant_id WHERE i.cart_id=$1 ORDER BY i.variant_id`,
    [cartId]
  );
  const lines = result.rows.map((row) => ({
    productId: row.product_id,
    variantId: row.variant_id,
    sku: row.sku,
    title: row.title,
    quantity: row.quantity,
    unitPrice: integer(row.unit_price_snapshot),
    lineTotal: integer(Number(row.unit_price_snapshot) * row.quantity)
  }));
  const subtotal = integer(
    lines.reduce((sum, line) => sum + line.lineTotal, 0)
  );
  return { ...first, lines, subtotal, total: subtotal };
}

async function lockScope(
  client: PoolClient,
  input: { customerId: string; conversationId: string }
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    input.conversationId
  ]);
  const scope = await client.query(
    'SELECT id FROM conversations WHERE id=$1 AND customer_id=$2 FOR UPDATE',
    [input.conversationId, input.customerId]
  );
  if (scope.rowCount !== 1) throw new Error('cart_scope_mismatch');
}

async function checkInventory(
  client: PoolClient,
  variantId: string,
  quantity: number
) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
    throw new CheckoutConfirmationError('inventory_unavailable');
  const variant = await client.query<{
    product_id: string;
    price: string;
    currency: string;
    available: number;
  }>(
    `SELECT v.product_id,v.price,p.currency,i.quantity_available-i.quantity_reserved AS available FROM product_variants v
     JOIN products p ON p.id=v.product_id JOIN inventory i ON i.variant_id=v.id
     WHERE v.id=$1 AND v.status='active' AND p.status='active' FOR UPDATE OF v,p,i`,
    [variantId]
  );
  const row = variant.rows[0];
  if (!row || row.available < quantity)
    throw new CheckoutConfirmationError('inventory_unavailable');
  return row;
}

export class PostgresCartRepository implements CartRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async upsertLine(
    input: Parameters<CartRepository['upsertLine']>[0]
  ): Promise<Cart> {
    return this.transaction(async (client) => {
      await lockScope(client, input);
      const variant = await checkInventory(
        client,
        input.variantId,
        input.quantity
      );
      if (variant.product_id !== input.productId)
        throw new Error('cart_scope_mismatch');
      let cart = await client.query<{
        id: string;
        currency: string;
        customer_id: string;
      }>(
        `SELECT id,currency,customer_id FROM carts WHERE conversation_id=$1 AND status='active' FOR UPDATE`,
        [input.conversationId]
      );
      if (cart.rows[0] && cart.rows[0].customer_id !== input.customerId)
        throw new Error('cart_scope_mismatch');
      if (!cart.rows[0])
        cart = await client.query(
          `INSERT INTO carts (customer_id,conversation_id,currency) VALUES ($1,$2,$3) RETURNING id,currency,customer_id`,
          [input.customerId, input.conversationId, variant.currency]
        );
      const row = cart.rows[0];
      if (row?.currency !== variant.currency)
        throw new Error('cart_currency_mismatch');
      await client.query(
        `INSERT INTO cart_items (cart_id,product_id,variant_id,quantity,unit_price_snapshot) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (cart_id,variant_id) DO UPDATE SET quantity=EXCLUDED.quantity,unit_price_snapshot=EXCLUDED.unit_price_snapshot,updated_at=now()`,
        [
          row.id,
          variant.product_id,
          input.variantId,
          input.quantity,
          variant.price
        ]
      );
      return readCart(client, row.id);
    });
  }

  async setLineQuantity(
    input: Parameters<CartRepository['setLineQuantity']>[0]
  ): Promise<Cart> {
    return this.transaction(async (client) => {
      await lockScope(client, input);
      const cartId = await this.activeCartId(client, input);
      await checkInventory(client, input.variantId, input.quantity);
      const updated = await client.query(
        'UPDATE cart_items SET quantity=$3,updated_at=now() WHERE cart_id=$1 AND variant_id=$2',
        [cartId, input.variantId, input.quantity]
      );
      if (updated.rowCount !== 1) throw new Error('Cart line was not found');
      return readCart(client, cartId);
    });
  }

  async removeLine(
    input: Parameters<CartRepository['removeLine']>[0]
  ): Promise<void> {
    await this.transaction(async (client) => {
      await lockScope(client, input);
      const cartId = await this.activeCartId(client, input);
      const result = await client.query(
        'DELETE FROM cart_items WHERE cart_id=$1 AND variant_id=$2',
        [cartId, input.variantId]
      );
      if (result.rowCount !== 1) throw new Error('Cart line was not found');
    });
  }

  private async activeCartId(
    client: PoolClient,
    input: { customerId: string; conversationId: string }
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT c.id FROM carts c JOIN conversations cv ON cv.id=c.conversation_id WHERE c.conversation_id=$1 AND c.customer_id=$2 AND cv.customer_id=$2 AND c.status='active' FOR UPDATE OF c`,
      [input.conversationId, input.customerId]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('cart_scope_mismatch');
    return id;
  }

  private async transaction<T>(
    run: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getActiveForConversation(
    conversationId: string
  ): Promise<ActiveCheckoutCart | null> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        conversationId
      ]);
      const result = await client.query<{ id: string; version: number }>(
        `SELECT id,version FROM carts WHERE conversation_id=$1 AND status='active' FOR SHARE`,
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
    });
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
