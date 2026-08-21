# ADR 0001: TypeScript monorepo

## Context

The API, channel integration, persistence, queue, and later admin application share contracts but need enforceable boundaries.

## Decision

Use pnpm workspaces with strict TypeScript and small packages. Fastify composition remains in `apps/api`; provider-neutral contracts live in packages.

## Consequences

Workspace quality gates cover every package. Cross-package APIs must remain explicit and buildable under NodeNext.

## Alternatives considered

A single package was simpler initially but would blur transport, persistence, and future domain boundaries.
