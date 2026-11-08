import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export async function seedCommerceFixture(pool: Pool, available = 10) {
  const id = randomUUID();
  const result = await pool.query<{
    customer_id: string;
    conversation_id: string;
    product_id: string;
    variant_id: string;
  }>(
    `WITH page AS (INSERT INTO pages (meta_page_id,name) VALUES ($1,'Commerce test') RETURNING id),
      customer AS (INSERT INTO customers (page_id,meta_psid) SELECT id,$1 FROM page RETURNING id,page_id),
      conversation AS (INSERT INTO conversations (page_id,customer_id) SELECT page_id,id FROM customer RETURNING id),
      category AS (INSERT INTO product_categories (slug,name) VALUES ($1,'Test') RETURNING id),
      product AS (INSERT INTO products (name,slug,description,category_id,base_price,currency,search_text) SELECT 'Cake',$1,'Test cake',id,120000,'VND','cake' FROM category RETURNING id),
      variant AS (INSERT INTO product_variants (product_id,sku,title,price) SELECT id,$1,'Small',120000 FROM product RETURNING id,product_id),
      stock AS (INSERT INTO inventory (variant_id,quantity_available) SELECT id,$2 FROM variant)
     SELECT customer.id AS customer_id,conversation.id AS conversation_id,variant.product_id,variant.id AS variant_id FROM customer CROSS JOIN conversation CROSS JOIN variant`,
    [id, available]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Commerce test fixture missing');
  return {
    customerId: row.customer_id,
    conversationId: row.conversation_id,
    productId: row.product_id,
    variantId: row.variant_id,
    sku: id,
    title: 'Small',
    unitPrice: 120000,
    currency: 'VND'
  };
}
