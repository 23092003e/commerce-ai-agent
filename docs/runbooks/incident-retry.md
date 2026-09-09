# Queue Retry and Delivery Incident Runbook

## Retry policy

- BullMQ retries webhook processing up to five times with exponential backoff.
- Retryable Meta errors are `rate_limited`, `server_error`, `timeout`, and
  `network` failures as classified by the channel adapter.
- `authentication`, `invalid_request`, and `invalid_response` are terminal.
  A terminal Meta delivery error records an agent failure and requests human
  handover with a `meta_delivery_*` reason.

## Investigate a failed event

1. Find the event by its `webhook_event_id` or `trace_id` in structured logs.
2. Check BullMQ state. A queued/delayed job is still being handled; do not
   manually replay it. A failed job has exhausted attempts.
3. For authentication, validate the Page token in the secret store and rotate
   it if necessary. Never paste the token into a terminal, ticket, or log.
4. For rate limits, reduce outbound volume and wait for the provider window;
   re-enqueue only the specific failed event after the cause is resolved.
5. For an invalid request, inspect the redacted error code and conversation
   state. Staff handles the open handover; do not create a new automated reply.

## Recovery invariant

Webhook persistence and inbound-message creation are idempotent. A replay may
resume processing a failed event, but it must not create a second inbound
message, cart mutation, or order.
