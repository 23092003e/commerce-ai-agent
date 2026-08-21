# ADR 0004: Custom bounded tool orchestrator

## Context

The sales agent needs auditable tool authorization and deterministic transactional gates.

## Decision

Build a small provider-neutral orchestration loop with validated decisions and a fixed maximum number of tool steps.

## Consequences

Authorization remains in code and provider changes stay isolated. More orchestration code is maintained locally.

## Alternatives considered

Framework-driven or multi-agent orchestration adds hidden behavior and unnecessary V1 complexity.
