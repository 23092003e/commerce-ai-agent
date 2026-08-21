# ADR 0003: Structured catalog, not RAG

## Context

Prices, variants, stock, and promotions are transactional facts.

## Decision

Keep commerce truth in relational tables and query it through validated structured tools. Reserve RAG for policies and approved business knowledge.

## Consequences

The model cannot invent or overwrite transactional facts. Semantic discovery may rank candidates later, but structured filters remain authoritative.

## Alternatives considered

Embedding the catalog as the primary source risks stale prices and inventory.
