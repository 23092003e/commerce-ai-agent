ALTER TABLE checkout_drafts
  ADD COLUMN confirmation_prepared_at timestamptz,
  ADD COLUMN confirmation_expires_at timestamptz,
  ADD COLUMN confirmation_consumed_at timestamptz,
  ADD COLUMN confirmation_lines jsonb;

-- Legacy confirmations were never shown as immutable prepared summaries.
UPDATE checkout_drafts SET confirmation_id = NULL, confirmation_snapshot = NULL;

ALTER TABLE checkout_drafts ADD CONSTRAINT checkout_confirmation_lifetime CHECK (
  (confirmation_id IS NULL AND confirmation_prepared_at IS NULL AND confirmation_expires_at IS NULL AND confirmation_consumed_at IS NULL AND confirmation_lines IS NULL)
  OR (confirmation_id IS NOT NULL AND confirmation_prepared_at IS NOT NULL AND confirmation_expires_at IS NOT NULL AND confirmation_lines IS NOT NULL
      AND confirmation_expires_at > confirmation_prepared_at
      AND (confirmation_consumed_at IS NULL OR confirmation_consumed_at >= confirmation_prepared_at))
);
CREATE UNIQUE INDEX checkout_drafts_active_confirmation_idx ON checkout_drafts (confirmation_id)
WHERE confirmation_id IS NOT NULL AND confirmation_consumed_at IS NULL;

CREATE FUNCTION invalidate_cart_checkout_confirmation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE target_cart_id uuid;
BEGIN
  target_cart_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.cart_id ELSE NEW.cart_id END;
  UPDATE checkout_drafts SET confirmation_id = NULL, confirmation_snapshot = NULL,
    confirmation_prepared_at = NULL, confirmation_expires_at = NULL,
    confirmation_consumed_at = NULL, confirmation_lines = NULL, updated_at = now()
  WHERE cart_id = target_cart_id AND confirmation_consumed_at IS NULL;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cart_items_invalidate_checkout_confirmation
AFTER INSERT OR UPDATE OR DELETE ON cart_items
FOR EACH ROW EXECUTE FUNCTION invalidate_cart_checkout_confirmation();
