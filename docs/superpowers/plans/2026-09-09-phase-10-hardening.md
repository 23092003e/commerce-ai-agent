# Phase 10 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent release candidate measurable, resilient to retryable delivery failures, and operationally supportable before real Page activation.

**Architecture:** Keep deterministic golden evaluations in the domain package, where scripted decisions and in-memory fakes make asserted tool use and outcomes repeatable. Add observability at the worker boundary so every production outcome emits only bounded, non-PII labels. Treat delivery failures as durable queue work: retry only retryable channel errors and record terminal failure rather than silently dropping a customer reply.

**Tech Stack:** TypeScript, Vitest, BullMQ/Redis, Fastify, PostgreSQL, Pino, GitHub Actions.

**Spec:** `FACEBOOK_FANPAGE_AI_SALES_AGENT_BUILD_SPEC.md` sections 19-21, 29 Phase 10, and 34.

## Global Constraints

- Product prices, stock, variants, carts, and orders remain structured database facts, never RAG output.
- The LLM must not create an order without the server-side confirmation token.
- Human-controlled conversations must not receive automated customer messages.
- Logs must redact PII and secrets; Admin Desk must not expose chain-of-thought.
- Tests must run without an AI credential or a real Meta token.

---

### Task 1: Deterministic golden-evaluation runner

**Files:**

- Create: `packages/domain/src/evals.ts`
- Create: `packages/domain/tests/evals.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `runGoldenScenario(scenario)` returning `{ id, passed, failures }`.
- Each scenario declares scripted decisions, expected final result type, expected tool names, and forbidden customer-visible reply state.

- [ ] **Step 1: Write failing tests** for an exact product-search tool sequence, an unknown-policy handover, and a human-control suppression.
- [ ] **Step 2: Run** `pnpm --filter @fanpage/domain exec vitest run tests/evals.test.ts` and verify imports fail because the evaluator does not exist.
- [ ] **Step 3: Implement** `runGoldenScenario` around `createAgentOrchestrator` and `createScriptedDecisionProvider`; compare literal expected result and tool-call names.
- [ ] **Step 4: Run the targeted test** and then `pnpm test`.
- [ ] **Step 5: Commit** the evaluator, fixtures, exports, and tests.

### Task 2: Fifty scenario acceptance suite

**Files:**

- Create: `packages/domain/src/golden-scenarios.ts`
- Create: `packages/domain/tests/golden-scenarios.test.ts`
- Modify: `README.md`

**Interfaces:**

- Produces `goldenScenarios: GoldenScenario[]` with at least 50 unique ids.
- Categories are `product`, `knowledge`, `cart`, `checkout`, `inventory`, `safety`, and `human`.

- [ ] **Step 1: Write failing test** asserting 50 unique IDs and category coverage, and run it red.
- [ ] **Step 2: Add literal deterministic scenarios** that use the evaluator’s fake tools and assert outcome/tool selection; include prompt injection, unknown policy, invalid confirmation, inventory conflict, repeated failure, and human request cases.
- [ ] **Step 3: Run** `pnpm --filter @fanpage/domain exec vitest run tests/golden-scenarios.test.ts` and `pnpm test`.
- [ ] **Step 4: Document** the command and what a failed scenario means in README.
- [ ] **Step 5: Commit** the scenario suite.

### Task 3: Delivery reliability and terminal failure visibility

**Files:**

- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Modify: `apps/api/src/workers/inbound-message-worker.ts`
- Modify: `packages/queue/src/worker.ts`
- Modify: `apps/api/tests/agent-message-handler.test.ts`
- Modify: `apps/api/tests/meta-pipeline.integration.test.ts`

**Interfaces:**

- Retryable `MetaChannelError` continues through BullMQ attempts; non-retryable delivery causes a recorded handover reason.
- `onFinalFailure(eventKey, error)` records the final error outcome once and receives no raw credential.

- [ ] **Step 1: Write failing tests** for retryable delivery rethrow, non-retryable delivery handover, and one terminal queue callback after max attempts.
- [ ] **Step 2: Run targeted API tests** and confirm the behaviors are absent or incomplete.
- [ ] **Step 3: Implement** bounded error classification and terminal-failure recording without persisting raw provider responses.
- [ ] **Step 4: Run** API unit tests plus `pnpm test:integration` with local Postgres/Redis.
- [ ] **Step 5: Commit** the reliability slice.

### Task 4: Operational metrics and alert-ready logs

**Files:**

- Create: `packages/observability/src/metrics.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: `apps/api/src/main.ts`
- Create: `packages/observability/tests/metrics.test.ts`

**Interfaces:**

- Produces `recordOperationalMetric(name, value, labels)` with allowlisted metric names and primitive labels.
- Emits structured records for webhook failures, worker duration, agent duration, tool errors, Meta sends, handovers, and RAG no-evidence.

- [ ] **Step 1: Write failing tests** that reject unallowlisted metric names and redact disallowed label keys.
- [ ] **Step 2: Implement** a Pino-backed bounded metric emitter and use it at the API/worker outcome boundaries.
- [ ] **Step 3: Run** observability and API tests, then full lint/typecheck/test/build.
- [ ] **Step 4: Add** `docs/runbooks/monitoring.md` with the metric names, recommended alert thresholds, and response owner.
- [ ] **Step 5: Commit** metrics and runbook.

### Task 5: Load, deployment, and production-readiness runbooks

**Files:**

- Create: `scripts/load-webhook-fixture.ts`
- Create: `docs/runbooks/deploy.md`
- Create: `docs/runbooks/incident-retry.md`
- Create: `docs/production-readiness.md`
- Modify: `README.md`

**Interfaces:**

- `pnpm exec tsx scripts/load-webhook-fixture.ts --count 100 --concurrency 10` reports accepted/failed/latency percentile results using signed fixture requests.
- Readiness document maps every Phase 10 checklist item to an automated check, manual owner action, or an explicit external dependency.

- [ ] **Step 1: Write a script test** against a local Fastify inject adapter that verifies bounded concurrency and summary arithmetic.
- [ ] **Step 2: Implement** deterministic fixture load execution without real Meta credentials.
- [ ] **Step 3: Run** the load script against local API and verify no duplicate event IDs are reused.
- [ ] **Step 4: Add runbooks** for deploy/rollback, queue retry and dead-letter recovery, backup restore, monitoring, Meta app review, and token rotation.
- [ ] **Step 5: Run** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, and `git diff --check`; commit the final hardening artifacts.

## Coverage audit

- 50+ golden scenarios: Tasks 1-2.
- Load tests: Task 5.
- Meta contract and rate-limit handling: Task 3, using existing Meta channel contract suite.
- Runbooks and readiness checklist: Tasks 4-5.
- Production readiness evidence: Task 5 documents external Meta/app-review, monitoring, backup and deployment actions that code cannot perform without account access.
