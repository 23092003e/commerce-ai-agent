# ADR 0005: Explicit checkout state machine

## Context

Order creation is irreversible and cannot depend on unconstrained model interpretation.

## Decision

Represent checkout stages in application state and require a server-generated confirmation version before transactional order creation.

## Consequences

Cart, address, price, or stock changes invalidate confirmation and require the customer to confirm again.

## Alternatives considered

Prompt-only confirmation is not an enforceable safety boundary.
