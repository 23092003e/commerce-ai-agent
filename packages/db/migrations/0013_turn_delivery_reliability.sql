ALTER TYPE message_delivery_state ADD VALUE IF NOT EXISTS 'sending';
ALTER TYPE message_delivery_state ADD VALUE IF NOT EXISTS 'retryable';
ALTER TYPE message_delivery_state ADD VALUE IF NOT EXISTS 'unknown';

ALTER TABLE messages
  ADD COLUMN inbound_message_id uuid REFERENCES messages(id),
  ADD COLUMN recipient_id text,
  ADD COLUMN outbound_key text,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN last_error_code text,
  ADD COLUMN last_error text,
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN delivery_updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX messages_outbound_key_unique ON messages(outbound_key) WHERE outbound_key IS NOT NULL;
CREATE INDEX messages_inbound_delivery ON messages(inbound_message_id, delivery_state);
CREATE UNIQUE INDEX agent_runs_one_per_inbound_message ON agent_runs(inbound_message_id);
ALTER TABLE tool_calls ADD COLUMN step integer;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY agent_run_id ORDER BY created_at, id) AS step FROM tool_calls
) UPDATE tool_calls t SET step = n.step FROM numbered n WHERE t.id = n.id;
ALTER TABLE tool_calls ALTER COLUMN step SET NOT NULL;
ALTER TABLE tool_calls ADD CONSTRAINT tool_calls_positive_step CHECK (step > 0);
CREATE UNIQUE INDEX tool_calls_agent_run_step_unique ON tool_calls(agent_run_id, step);
