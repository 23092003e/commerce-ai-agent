ALTER TABLE webhook_events
  ADD COLUMN conversation_key text;

UPDATE webhook_events
SET conversation_key =
  'meta:' || provider_page_id || ':' || (raw_payload #>> '{event,sender,id}')
WHERE conversation_key IS NULL
  AND provider_page_id IS NOT NULL
  AND raw_payload #>> '{event,sender,id}' IS NOT NULL;

CREATE INDEX webhook_events_conversation_order_idx
  ON webhook_events (conversation_key, event_timestamp, external_event_key)
  WHERE processing_state IN ('received', 'queued', 'processing');
