# Phase 11 Turn and Delivery Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every inbound turn resumable, serialize the complete conversation workflow, and persist outbound delivery before calling Meta.

**Architecture:** A PostgreSQL advisory lease spans the full conversation turn. Inbound persistence, agent execution, outbound planning, delivery, and event finalization become distinct durable stages; retry resumes an existing outbound intent instead of rerunning model or mutation tools.

**Tech Stack:** TypeScript, PostgreSQL 16, Drizzle/pg, BullMQ, Redis, Fastify, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-production-completion-design.md`

## Global Constraints

- Preserve migrations `0001`–`0012`; create `0013_turn_delivery_reliability.sql`.
- Same-conversation work is serialized from context load through terminal event state.
- Different conversations retain worker concurrency.
- Meta network/timeout/ambiguous server outcomes are never blindly resent.
- A retry must never rerun completed mutation tools or regenerate reply text.
- No secret, PSID, raw message text, prompt, or full tool payload is logged.

---

### Task 1: Encode durable outbound and agent-turn idempotency

**Files:**

- Create: `packages/db/migrations/0013_turn_delivery_reliability.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/types.ts`
- Test: `packages/db/tests/turn-delivery.integration.test.ts`

**Interfaces:**

- Produces: `OutboundMessageView`, `OutboundDeliveryState`, and one agent run per inbound message.
- Migration adds outbound metadata to `messages` and a unique index on `agent_runs.inbound_message_id`.

- [ ] **Step 1: Write the migration test first**

  Assert that two outbound inserts with the same deterministic key return one
  row; two agent runs for the same inbound message violate the unique index;
  and existing inbound rows remain readable.

  ```ts
  expect(await countByOutboundKey(outboundKey)).toBe(1);
  await expect(insertSecondAgentRun(inboundMessageId)).rejects.toThrow();
  ```

- [ ] **Step 2: Run the focused integration test and confirm red**

  ```powershell
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/turn-delivery.integration.test.ts
  ```

  Expected failure: migration/table columns or unique constraint do not exist.

- [ ] **Step 3: Add the forward migration**

  Add delivery enum values `sending`, `retryable`, and `unknown`. Add nullable
  `inbound_message_id`, `recipient_id`, unique `outbound_key`, `attempts` with a
  non-negative check, `last_error_code`, `last_error`, `sent_at`, and
  `delivery_updated_at` to `messages`. Add a non-null positive `step` column to
  `tool_calls`, backfilling existing rows deterministically by creation order
  within each agent run before setting the constraint. Add:

  ```sql
  CREATE UNIQUE INDEX agent_runs_one_per_inbound_message
    ON agent_runs (inbound_message_id);

  CREATE UNIQUE INDEX messages_outbound_key_unique
    ON messages (outbound_key)
    WHERE outbound_key IS NOT NULL;

  CREATE UNIQUE INDEX tool_calls_agent_run_step_unique
    ON tool_calls (agent_run_id, step);
  ```

  The migration must not backfill historical sends or change existing inbound
  delivery states.

- [ ] **Step 4: Mirror the migration in Drizzle and domain-facing DB types**

  ```ts
  export type OutboundDeliveryState =
    | 'queued'
    | 'sending'
    | 'retryable'
    | 'sent'
    | 'delivered'
    | 'unknown'
    | 'failed';
  ```

- [ ] **Step 5: Run migration and focused test**

  ```powershell
  rtk pnpm.cmd db:migrate
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/turn-delivery.integration.test.ts
  ```

- [ ] **Step 6: Commit exact files**

  ```powershell
  rtk git add packages/db/migrations/0013_turn_delivery_reliability.sql packages/db/src/schema.ts packages/db/src/types.ts packages/db/tests/turn-delivery.integration.test.ts
  rtk git commit -m "feat: persist outbound delivery lifecycle"
  ```

### Task 2: Add a full-turn conversation lease

**Files:**

- Modify: `packages/db/src/types.ts`
- Modify: `packages/db/src/postgres.ts`
- Modify: `packages/db/src/in-memory.ts`
- Test: `packages/db/tests/conversation-concurrency.test.ts`

**Interfaces:**

- Produces:

  ```ts
  declare const conversationLeaseBrand: unique symbol;
  interface ConversationLeaseContext {
    readonly conversationKey: string;
    readonly [conversationLeaseBrand]: true;
  }

  interface CommerceRepository {
    withConversationLease<T>(
      conversationKey: string,
      operation: (lease: ConversationLeaseContext) => Promise<T>
    ): Promise<T>;
  }
  ```

- [ ] **Step 1: Add a failing concurrency test**

  Enter `withConversationLease` twice for the same key, prove the second
  callback remains pending until the first callback completes, and prove a
  different key enters immediately. Force the first callback to throw and prove
  the second still enters afterward.

- [ ] **Step 2: Confirm the test fails because the method is absent**

  ```powershell
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/conversation-concurrency.test.ts
  ```

- [ ] **Step 3: Implement the PostgreSQL lease**

  Reserve a dedicated pool client for the callback lifetime and execute:

  ```sql
  SELECT pg_advisory_lock(hashtextextended($1, 0));
  SELECT pg_advisory_unlock(hashtextextended($1, 0));
  ```

  A `finally` block unlocks and always returns the client to the pool. A lost
  process releases the session lock when PostgreSQL closes the connection. The
  branded lease context is passed to nested services so they reuse the outer
  lease instead of reacquiring the same key on another connection.

- [ ] **Step 4: Implement a keyed in-memory mutex with identical semantics**

  Delete idle mutex entries after callback completion so tests and local development do
  not leak keys.

- [ ] **Step 5: Run the focused test and package typecheck**

  ```powershell
  rtk pnpm.cmd --filter @fanpage/db typecheck
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/conversation-concurrency.test.ts
  ```

- [ ] **Step 6: Commit**

  ```powershell
  rtk git add packages/db/src/types.ts packages/db/src/postgres.ts packages/db/src/in-memory.ts packages/db/tests/conversation-concurrency.test.ts
  rtk git commit -m "feat: serialize complete conversation turns"
  ```

### Task 3: Separate inbound persistence from event completion

**Files:**

- Modify: `packages/db/src/types.ts`
- Modify: `packages/db/src/postgres.ts`
- Modify: `packages/db/src/in-memory.ts`
- Modify: `apps/api/src/workers/inbound-message-worker.ts`
- Test: `apps/api/tests/meta-ingestion.test.ts`
- Test: `apps/api/tests/meta-pipeline.integration.test.ts`

**Interfaces:**

- Produces:

  ```ts
  ensureInboundMessage(input: PersistInboundMessageInput): Promise<{
    messageId: string;
    customerId: string;
    conversation: ConversationView;
    inserted: boolean;
  }>;
  markWebhookEventProcessed(eventKey: string): Promise<void>;
  markWebhookEventQueuedForRetry(eventKey: string, errorCode: string): Promise<void>;
  ```

- [ ] **Step 1: Add red tests for the lost-reply regression**

  Test that the event remains `processing` after inbound persistence, becomes
  `processed` only after handler success, and a handler failure does not make
  the event terminal. On replay, `ensureInboundMessage` returns the original
  message and conversation instead of `{type:'duplicate'}`.

- [ ] **Step 2: Run the two focused suites and capture the expected failures**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/meta-ingestion.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts apps/api/tests/meta-pipeline.integration.test.ts
  ```

- [ ] **Step 3: Refactor repository lifecycle methods**

  Remove the `processingState: 'processed'` update from inbound persistence.
  Make `ensureInboundMessage` select the existing message/customer/conversation
  after a uniqueness conflict. Increment webhook attempts when a processing
  attempt begins, not when inbound persistence succeeds.

- [ ] **Step 4: Hold the conversation lease around the complete worker turn**

  Worker order:

  ```text
  get event -> acquire conversation lease -> claim/recheck ordering
  -> ensure inbound message -> handle/resume agent turn
  -> mark event processed -> release lease
  ```

  Every early return releases the lease. `ignored` remains terminal.

- [ ] **Step 5: Prove same-conversation handlers do not overlap**

  Extend the integration test with a deferred promise inside the first handler;
  assert the second same-key handler has not entered, then release the first.
  Assert a different customer handler enters concurrently.

- [ ] **Step 6: Run focused tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/meta-ingestion.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts apps/api/tests/meta-pipeline.integration.test.ts
  rtk git add packages/db/src/types.ts packages/db/src/postgres.ts packages/db/src/in-memory.ts apps/api/src/workers/inbound-message-worker.ts apps/api/tests/meta-ingestion.test.ts apps/api/tests/meta-pipeline.integration.test.ts
  rtk git commit -m "fix: complete webhook events after agent outcome"
  ```

### Task 4: Implement an idempotent outbound message repository

**Files:**

- Create: `packages/db/src/outbound-message-postgres.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/admin-postgres.ts`
- Test: `packages/db/tests/turn-delivery.integration.test.ts`

**Interfaces:**

- Produces:

  ```ts
  interface OutboundMessageRepository {
    planText(input: {
      conversationId: string;
      inboundMessageId: string;
      recipientId: string;
      outboundKey: string;
      text: string;
    }): Promise<OutboundMessageView>;
    findByInboundMessage(
      inboundMessageId: string
    ): Promise<OutboundMessageView | null>;
    claimForSend(
      messageId: string
    ): Promise<'claimed' | 'already_sent' | 'uncertain'>;
    markSent(messageId: string, metaMessageId: string): Promise<void>;
    markRetryable(
      messageId: string,
      code: string,
      message: string
    ): Promise<void>;
    markUnknown(
      messageId: string,
      code: string,
      message: string
    ): Promise<void>;
    markFailed(messageId: string, code: string, message: string): Promise<void>;
  }
  ```

- [ ] **Step 1: Add repository state-machine tests**

  Cover duplicate planning, queued-to-sending claim, sent replay, retryable
  reclaim, sending replay becoming uncertain, and bounded error persistence.

- [ ] **Step 2: Run the test and verify red**

  ```powershell
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/turn-delivery.integration.test.ts
  ```

- [ ] **Step 3: Implement compare-and-set SQL transitions**

  All transitions use `UPDATE ... WHERE delivery_state IN (...) RETURNING`.
  `planText` uses `ON CONFLICT (outbound_key) DO UPDATE SET outbound_key =
EXCLUDED.outbound_key` and returns the original immutable text.

- [ ] **Step 4: Include outbound rows in Admin message history**

  Keep chronological order and expose delivery state without returning
  recipient PSID or raw provider errors.

- [ ] **Step 5: Run DB tests and commit**

  ```powershell
  rtk pnpm.cmd --filter @fanpage/db typecheck
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/turn-delivery.integration.test.ts packages/db/tests/agent-run.integration.test.ts
  rtk git add packages/db/src/outbound-message-postgres.ts packages/db/src/index.ts packages/db/src/admin-postgres.ts packages/db/tests/turn-delivery.integration.test.ts
  rtk git commit -m "feat: add resumable outbound message store"
  ```

### Task 5: Resume delivery without rerunning the agent

**Files:**

- Modify: `packages/domain/src/agent-orchestrator.ts`
- Modify: `packages/db/src/agent-run-postgres.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/tests/agent-message-handler.test.ts`
- Test: `apps/api/tests/meta-pipeline.integration.test.ts`

**Interfaces:**

- Consumes: `OutboundMessageRepository` from Task 4.
- Produces: `AgentHandlingResult = { outcome: 'replied' | 'handed_over' | 'no_action'; outboundMessageId?: string }`.

- [ ] **Step 1: Write fault-injection tests**

  Required cases:

  - provider failure before any outbound plan opens handover and returns a
    terminal handled outcome;
  - Meta 429 persists `retryable`, rethrows, and the retry sends the same stored
    text without a second provider or mutation-tool call;
  - network/timeout persists `unknown`, opens handover, and does not resend;
  - authentication/invalid request persists `failed` and opens handover;
  - a persisted `sent` row makes replay a no-op;
  - an existing running/failed agent run is reused by inbound message ID.

- [ ] **Step 2: Confirm current behavior fails the retry-resume assertions**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/agent-message-handler.test.ts
  ```

- [ ] **Step 3: Plan before sending**

  Derive `outboundKey` as
  `sha256("meta:text:" + inboundMessageId + ":primary")`. Persist the exact
  rendered text, then claim it for delivery. Never send unpersisted text.

- [ ] **Step 4: Implement conservative error classification**

  Change channel classification so only definitive rate-limit rejection is
  automatically retryable. Treat transport timeouts, network failures, and
  ambiguous 5xx results as `unknown`. Preserve bounded Meta error codes without
  response bodies.

- [ ] **Step 5: Make agent runs idempotent**

  `startOrResume(inboundMessageId, ...)` returns the existing run and its final
  outcome. A replay with pending delivery bypasses `provider.decide()` and
  mutation tools.

- [ ] **Step 6: Wire repository and close it during shutdown**

  Instantiate `PostgresOutboundMessageRepository` in `main.ts`, inject it into
  the handler, and close its pool after the worker stops.

- [ ] **Step 7: Run focused unit and integration tests**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/agent-message-handler.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts apps/api/tests/meta-pipeline.integration.test.ts packages/db/tests/turn-delivery.integration.test.ts
  ```

- [ ] **Step 8: Commit**

  ```powershell
  rtk git add packages/domain/src/agent-orchestrator.ts packages/db/src/agent-run-postgres.ts apps/api/src/workers/agent-message-handler.ts apps/api/src/main.ts apps/api/tests/agent-message-handler.test.ts apps/api/tests/meta-pipeline.integration.test.ts
  rtk git commit -m "fix: resume persisted outbound delivery on retry"
  ```

### Task 6: Finalize queue failure exactly once

**Files:**

- Modify: `packages/queue/src/worker.ts`
- Modify: `apps/api/src/workers/inbound-message-worker.ts`
- Create: `packages/queue/tests/worker.test.ts`
- Test: `apps/api/tests/meta-pipeline.integration.test.ts`

**Interfaces:**

- `onFinalFailure(eventKey, error)` remains the terminal hook and is invoked
  only from the awaited processor catch when the current attempt is the final
  configured attempt. The BullMQ `failed` event is logging-only.

- [ ] **Step 1: Add a test counting finalization calls**

  Force all attempts to fail and assert `onFinalFailure` is called exactly
  once. Force an intermediate failure and assert zero terminal calls.

- [ ] **Step 2: Remove failed-listener terminal finalization**

  Keep the final-attempt check inside the processor catch, await one idempotent
  finalizer, then rethrow the original job error. The `failed` listener records
  bounded diagnostics only. If finalization itself fails, emit worker `error`
  and still fail the job without recursively finalizing.

- [ ] **Step 3: Make terminal DB finalization idempotent**

  Update only events not already in `processed`, `ignored`, or `failed`; open
  the delivery handover through the idempotent control service interface that
  Phase 14 will centralize.

- [ ] **Step 4: Run focused tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/queue/tests/worker.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts apps/api/tests/meta-pipeline.integration.test.ts
  rtk git add packages/queue/src/worker.ts apps/api/src/workers/inbound-message-worker.ts packages/queue/tests/worker.test.ts apps/api/tests/meta-pipeline.integration.test.ts
  rtk git commit -m "fix: finalize exhausted webhook jobs once"
  ```

### Task 7: Phase 11 verification and documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/incident-retry.md`
- Modify: `docs/production-readiness.md`

- [ ] **Step 1: Document the exact lifecycle and operator actions**

  Include event states, outbound states, automatic retry boundary, unknown
  delivery handling, safe redelivery, and SQL queries using only IDs/statuses.

- [ ] **Step 2: Run the full phase gate**

  ```powershell
  rtk pnpm.cmd lint
  rtk pnpm.cmd typecheck
  rtk pnpm.cmd test
  rtk pnpm.cmd test:integration
  rtk pnpm.cmd build
  rtk git diff --check
  ```

- [ ] **Step 3: Confirm fault-injection evidence**

  Record counts proving one inbound row, one agent run, one outbound intent,
  one mutation, and either one sent message or one handover for every tested
  failure boundary.

- [ ] **Step 4: Commit documentation**

  ```powershell
  rtk git add README.md docs/runbooks/incident-retry.md docs/production-readiness.md
  rtk git commit -m "docs: define durable turn recovery operations"
  ```

## Phase 11 Exit Criteria

- Retryable delivery resumes stored text without a second model/tool run.
- Ambiguous delivery never auto-resends and always produces visible handover.
- Event processing becomes terminal only after reply, suppression, or handover.
- Same-conversation handler overlap is impossible in integration tests.
- Different conversations still execute concurrently.
- Terminal finalization occurs exactly once.
- Outbound messages and delivery states appear in Admin history.
- Full phase gate is green.
