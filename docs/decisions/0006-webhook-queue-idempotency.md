# ADR 0006: Webhook queue idempotency

## Context

Meta retries and queue retries can deliver the same event more than once.

## Decision

Persist a deterministic external event key before enqueueing. Use a deterministic BullMQ job ID, database uniqueness, and idempotent transactional processing.

## Consequences

Retries are safe and acknowledged HTTP requests do not perform slow agent work. A received event can be re-enqueued after a transient queue failure.

## Alternatives considered

In-memory dedupe fails across restarts and horizontally scaled processes.
