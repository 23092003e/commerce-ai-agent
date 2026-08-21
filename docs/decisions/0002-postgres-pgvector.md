# ADR 0002: PostgreSQL and pgvector

## Context

Commerce state requires transactions and future knowledge retrieval needs full-text and vector search.

## Decision

Use PostgreSQL as the system of record and add pgvector in the knowledge phase. Use immutable SQL migrations with checksum tracking.

## Consequences

Webhook idempotency and conversation mutation can rely on database constraints and transactions. Recovery uses forward migrations or database restore.

## Alternatives considered

A separate vector database adds operations and consistency costs before scale demonstrates a need.
