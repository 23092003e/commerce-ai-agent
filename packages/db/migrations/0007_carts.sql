CREATE TYPE cart_status AS ENUM ('active', 'converted', 'abandoned');

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  status cart_status NOT NULL DEFAULT 'active',
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX carts_one_active_per_conversation
  ON carts (conversation_id)
  WHERE status = 'active';

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_snapshot bigint NOT NULL CHECK (unit_price_snapshot >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);

CREATE INDEX carts_customer_status_idx ON carts (customer_id, status);
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE carts, cart_items FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE carts, cart_items FROM authenticated;
  END IF;
END;
$$;
