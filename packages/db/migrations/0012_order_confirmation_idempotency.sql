ALTER TABLE orders ADD COLUMN confirmation_id text;
CREATE UNIQUE INDEX orders_confirmation_id_unique
  ON orders (confirmation_id)
  WHERE confirmation_id IS NOT NULL;
