# ADR 0008: Authoritative human handover state

## Context

AI and human operators must never race to reply to the same customer.

## Decision

Store control mode and handover lifecycle in the database. Future send authorization will reject AI customer-facing output while human control is active.

## Consequences

Handover works across restarts and cannot be bypassed by prompt content.

## Alternatives considered

A prompt instruction or process-local flag is not durable or enforceable.
