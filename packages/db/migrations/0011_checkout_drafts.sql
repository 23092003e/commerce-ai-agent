CREATE TABLE checkout_drafts (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id),
  cart_id uuid REFERENCES carts(id),
  cart_version integer,
  recipient_name text,
  phone text,
  address jsonb,
  payment_method payment_method,
  confirmation_id text,
  confirmation_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    confirmation_id IS NULL
    OR (cart_id IS NOT NULL AND cart_version IS NOT NULL AND confirmation_snapshot IS NOT NULL)
  )
);

ALTER TABLE checkout_drafts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE checkout_drafts FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE checkout_drafts FROM authenticated;
  END IF;
END; $$;
