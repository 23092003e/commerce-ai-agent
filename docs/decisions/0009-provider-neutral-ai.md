# ADR 0009: Provider-neutral AI

## Context

Model availability, capability, price, and policy change over time.

## Decision

Future AI work will depend on an internal structured-generation/text/embedding interface, not a provider SDK in domain code.

## Consequences

Providers and fake deterministic implementations can be exchanged without changing commerce rules.

## Alternatives considered

Direct SDK calls are initially faster but couple business logic to one vendor.
