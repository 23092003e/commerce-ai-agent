CREATE TYPE order_status AS ENUM ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled');
CREATE TYPE payment_method AS ENUM ('cod', 'bank_transfer', 'other');
CREATE TYPE payment_status AS ENUM ('unpaid', 'pending', 'paid', 'failed', 'refunded');

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  status order_status NOT NULL DEFAULT 'pending',
  recipient_name text NOT NULL,
  phone text NOT NULL,
  address jsonb NOT NULL,
  payment_method payment_method NOT NULL,
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  currency char(3) NOT NULL,
  subtotal bigint NOT NULL CHECK (subtotal >= 0),
  shipping_fee bigint NOT NULL CHECK (shipping_fee >= 0),
  discount_total bigint NOT NULL CHECK (discount_total >= 0),
  total bigint NOT NULL CHECK (total >= 0),
  source text NOT NULL DEFAULT 'facebook_messenger',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total = subtotal + shipping_fee - discount_total)
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  sku_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  line_total bigint NOT NULL CHECK (line_total >= 0),
  CHECK (line_total = quantity * unit_price)
);
CREATE INDEX orders_conversation_created_idx ON orders (conversation_id, created_at DESC);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE orders, order_items FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE orders, order_items FROM authenticated; END IF;
END; $$;
