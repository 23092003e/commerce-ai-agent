# ADR 0007: Channel adapter boundary

## Context

Meta payloads, API versions, and messaging policies change independently of commerce logic.

## Decision

Keep signature, normalization, and outbound Graph payloads in `packages/meta` behind typed interfaces.

## Consequences

Domain and future agent packages do not construct Graph API payloads. Fake channel tests require no Meta credentials.

## Alternatives considered

Embedding Graph calls in route or domain modules would spread provider-specific behavior.
