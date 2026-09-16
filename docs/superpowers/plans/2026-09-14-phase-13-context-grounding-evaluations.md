# Phase 13 Context, Grounding, and Evaluations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conversations work across turns, enforce evidence-backed replies in application code, and replace shallow golden checks with behavior and state assertions.

**Architecture:** A bounded context loader assembles history, summary, cart, checkout, and product references from structured repositories. Tools produce a per-turn result ledger; final reply facts must resolve through that ledger and are rendered deterministically while the model controls only natural connective language.

**Tech Stack:** TypeScript, Zod, PostgreSQL, OpenAI-compatible structured output, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-production-completion-design.md`

## Global Constraints

- No unlimited transcript is sent to a provider.
- Structured commerce state is authoritative; summaries cannot overwrite it.
- Tool arguments are validated before execution and ownership scope is injected
  by trusted code.
- Policy chunks must be active, returned in the current turn, and explicitly
  referenced by the final decision.
- Transactional values are rendered from typed results, never model prose.
- Deterministic CI does not call a paid model; live-model evaluation is a
  separate opt-in command.

---

### Task 1: Load bounded multi-turn context

**Files:**

- Modify: `packages/domain/src/agent-context.ts`
- Create: `packages/db/src/conversation-context-postgres.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Test: `packages/domain/tests/agent-orchestrator.test.ts`
- Test: `packages/db/tests/conversation-context.integration.test.ts`

**Interfaces:**

- Produces:

  ```ts
  interface ConversationContextRepository {
    load(input: {
      conversationId: string;
      recentMessageLimit: 12;
      recentCharacterBudget: 4000;
    }): Promise<Omit<AgentContext, 'customerMessage'>>;
  }
  ```

- [ ] **Step 1: Write schema boundary tests**

  Assert 12-message and 4,000-character caps, 2,000-character summary cap,
  strict cart/checkout/reference shapes, and rejection of raw phone/address in
  `recentMessages` metadata.

- [ ] **Step 2: Write an integration fixture with more than 12 messages**

  Verify newest bounded messages remain chronological, outbound delivery rows
  appear, structured cart/checkout state is current, and product reference
  ordering is preserved.

- [ ] **Step 3: Run focused tests and verify red**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/agent-orchestrator.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/conversation-context.integration.test.ts
  ```

- [ ] **Step 4: Implement context queries**

  Use explicit projections. Never select raw payloads. Redact checkout PII from
  recent messages and expose only `missingFields` plus the prepared
  confirmation ID/state to the general decision provider.

- [ ] **Step 5: Load fresh context under the Phase 11 conversation lease**

  Replace `productReferences: []`. Merge only the current inbound message from
  trusted worker input; all prior state comes from the repository.

- [ ] **Step 6: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/agent-orchestrator.test.ts apps/api/tests/agent-message-handler.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/conversation-context.integration.test.ts
  rtk git add packages/domain/src/agent-context.ts packages/db/src/conversation-context-postgres.ts packages/db/src/index.ts apps/api/src/main.ts apps/api/src/workers/agent-message-handler.ts packages/domain/tests/agent-orchestrator.test.ts packages/db/tests/conversation-context.integration.test.ts
  rtk git commit -m "feat: load bounded conversation context"
  ```

### Task 2: Persist safe tool arguments and result ledgers

**Files:**

- Modify: `packages/domain/src/agent-orchestrator.ts`
- Modify: `packages/domain/src/agent-tools.ts`
- Modify: `packages/db/src/agent-run-postgres.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Test: `packages/domain/tests/agent-orchestrator.test.ts`
- Test: `packages/db/tests/agent-run.integration.test.ts`

**Interfaces:**

- Produces:

  ```ts
  interface AgentToolTrace {
    step: number;
    name: AgentToolName;
    status: 'succeeded' | 'failed';
    argumentSummary: Record<string, string | number | boolean | null>;
    resultSummary: Record<string, string | number | boolean | null>;
    resultRefIds: string[];
    latencyMs: number;
  }
  ```

- [ ] **Step 1: Add trace tests**

  Verify variant/product/cart/document/chunk IDs and bounded numeric facts are
  retained, while query text, recipient data, addresses, provider payloads,
  prompts, and arbitrary nested content are excluded.

- [ ] **Step 2: Add per-tool projection functions**

  Each registered tool owns explicit `projectArguments` and `projectResult`
  functions. Do not implement a generic recursive serializer.

- [ ] **Step 3: Persist step order and safe summaries**

  Replace the current empty `{}` arguments/results. Consume the unique
  `(agent_run_id, step)` constraint introduced by migration `0013` and use
  upsert/no-op semantics on replay.

- [ ] **Step 4: Run focused tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/agent-orchestrator.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/agent-run.integration.test.ts
  rtk git add packages/domain/src/agent-orchestrator.ts packages/domain/src/agent-tools.ts packages/db/src/agent-run-postgres.ts apps/api/src/workers/agent-message-handler.ts packages/domain/tests/agent-orchestrator.test.ts packages/db/tests/agent-run.integration.test.ts
  rtk git commit -m "feat: record safe tool evidence ledgers"
  ```

### Task 3: Enforce grounded reply facts

**Files:**

- Create: `packages/domain/src/grounded-reply.ts`
- Modify: `packages/domain/src/agent-orchestrator.ts`
- Modify: `packages/domain/src/openai-decision-provider.ts`
- Modify: `packages/domain/src/sales-prompts.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/grounded-reply.test.ts`
- Test: `packages/domain/tests/openai-decision-provider.test.ts`

**Interfaces:**

- Produces:

  ```ts
  function validateAndRenderGroundedReply(input: {
    decision: AgentReplyDecision;
    ledger: AgentToolTrace[];
    locale: string;
  }): { text: string; evidenceChunkIds: string[] };
  ```

- [ ] **Step 1: Write failing authorization tests**

  Reject a product, variant, cart, confirmation, order, or chunk ID absent from
  the current ledger. Reject archived/unreturned chunks and knowledge replies
  with empty evidence. Reject price/stock/order text supplied as an unstructured
  model claim.

- [ ] **Step 2: Write successful rendering tests**

  Given typed ledger values, assert exact Vietnamese rendering for product
  names, prices, inventory, cart totals, checkout confirmation, order number,
  and policy excerpts. Assert “em” and “anh/chị” persona rules without forcing
  identical full prose.

- [ ] **Step 3: Replace the provider JSON schema**

  Implement the `AgentReplyDecision` union from the master spec. Limit `intro`
  and `nextQuestion` to 300 characters, fact count to 10, and knowledge chunk
  count to 10. Keep `.strict()` validation at the application boundary.

- [ ] **Step 4: Implement deterministic fact renderers**

  Model prose may connect facts but cannot carry price, stock, totals, or order
  numbers. Append rendered fact sentences from ledger values and one validated
  next question.

- [ ] **Step 5: Convert grounding failure into handover**

  Return typed `grounding_failed`, persist the failed agent outcome, and open an
  idempotent handover. Do not send the rejected model text.

- [ ] **Step 6: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/grounded-reply.test.ts packages/domain/tests/openai-decision-provider.test.ts packages/domain/tests/agent-orchestrator.test.ts
  rtk git add packages/domain/src/grounded-reply.ts packages/domain/src/agent-orchestrator.ts packages/domain/src/openai-decision-provider.ts packages/domain/src/sales-prompts.ts packages/domain/src/index.ts packages/domain/tests/grounded-reply.test.ts packages/domain/tests/openai-decision-provider.test.ts
  rtk git commit -m "feat: enforce grounded customer replies"
  ```

### Task 4: Wire deterministic product references

**Files:**

- Modify: `packages/domain/src/product-references.ts`
- Modify: `packages/db/src/product-reference-postgres.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Test: `apps/api/tests/agent-message-handler.test.ts`
- Test: `packages/db/tests/conversation-context.integration.test.ts`

**Interfaces:**

- Catalog result rendering produces ordered references saved with the current
  conversation version before outbound delivery.

- [ ] **Step 1: Add a two-turn “mẫu 2” test**

  First turn returns three catalog products and stores positions 1–3. Second
  turn refers to position two and must call `catalog.getProduct` or
  `catalog.getVariant` with the exact stored ID, not perform a new ambiguous
  search.

- [ ] **Step 2: Add stale-reference tests**

  Archived products and variants outside the referenced product return an
  invalid reference outcome and ask a narrowing question.

- [ ] **Step 3: Wire `PostgresProductReferenceStore` in runtime**

  Save references under the full-turn lease with optimistic conversation
  version handling. Include its pool in graceful shutdown.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/agent-message-handler.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/conversation-context.integration.test.ts
  rtk git add packages/domain/src/product-references.ts packages/db/src/product-reference-postgres.ts apps/api/src/main.ts apps/api/src/workers/agent-message-handler.ts apps/api/tests/agent-message-handler.test.ts packages/db/tests/conversation-context.integration.test.ts
  rtk git commit -m "feat: resolve follow-up product references"
  ```

### Task 5: Add bounded conversation summaries

**Files:**

- Create: `packages/domain/src/conversation-summary.ts`
- Create: `packages/db/src/conversation-summary-postgres.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Test: `packages/domain/tests/conversation-summary.test.ts`
- Test: `packages/db/tests/conversation-context.integration.test.ts`

**Interfaces:**

- Produces `shouldRefreshSummary(lastSummaryAt, messagesSinceSummary, now)` and
  a strict summary schema containing goal, constraints, preferences, discussed
  product IDs, and unresolved questions.

- [ ] **Step 1: Test the 12-message/24-hour refresh rule**

  Verify no refresh below both thresholds, refresh at either threshold, and no
  provider call in human/paused mode unless explicitly enabled by safe config.

- [ ] **Step 2: Test summary safety**

  Reject phone, email, full address, price, stock, cart quantity, and order
  status fields from summary output. Product identifiers may be retained.

- [ ] **Step 3: Implement summary persistence with optimistic versioning**

  Store at most 2,000 characters plus `summary_updated_at`. A summary failure is
  non-fatal and emits a bounded metric; it does not fail or retry the customer
  turn.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/conversation-summary.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/conversation-context.integration.test.ts
  rtk git add packages/domain/src/conversation-summary.ts packages/db/src/conversation-summary-postgres.ts apps/api/src/main.ts apps/api/src/workers/agent-message-handler.ts packages/domain/tests/conversation-summary.test.ts packages/db/tests/conversation-context.integration.test.ts
  rtk git commit -m "feat: maintain bounded conversation summaries"
  ```

### Task 6: Replace shallow golden scenarios with executable contracts

**Files:**

- Modify: `packages/domain/src/evals.ts`
- Replace: `packages/domain/src/golden-scenarios.ts`
- Modify: `packages/domain/tests/evals.test.ts`
- Modify: `packages/domain/tests/golden-scenarios.test.ts`
- Create: `packages/domain/tests/golden-fixtures.ts`

**Interfaces:**

- Every `GoldenScenario` includes initial state, tool fixtures, allowed calls,
  expected validated arguments, expected fact references, expected final state,
  and forbidden effects.

- [ ] **Step 1: Strengthen the evaluator contract**

  ```ts
  interface GoldenExpected {
    outcome: 'reply' | 'handover' | 'suppressed';
    calls: Array<{ name: AgentToolName; arguments: unknown }>;
    factRefs: AgentReplyDecision['facts'];
    evidenceChunkIds: string[];
    state: Record<string, unknown>;
    forbiddenCalls: AgentToolName[];
  }
  ```

  Compare normalized structured values; never compare only joined tool names.

- [ ] **Step 2: Write evaluator self-tests**

  Prove the evaluator fails one case each for wrong arguments, forbidden call,
  wrong DB state, invented fact ref, wrong handover, missing confirmation, and
  wrong chunk ID.

- [ ] **Step 3: Rewrite at least 50 literal scenario fixtures**

  Cover every original-spec category and include multi-turn state for follow-up
  references, checkout across messages, stale inventory, injection, and human
  control. Fake tools return realistic typed results and mutate an explicit
  in-memory state object.

- [ ] **Step 4: Add release coverage assertions**

  Require unique IDs, all categories, at least five cross-turn cases, at least
  five failure-injection cases, and at least one assertion for every
  `GoldenExpected` field.

- [ ] **Step 5: Run deterministic suite and commit**

  ```powershell
  rtk pnpm.cmd --filter @fanpage/domain exec vitest run tests/evals.test.ts tests/golden-scenarios.test.ts
  rtk git add packages/domain/src/evals.ts packages/domain/src/golden-scenarios.ts packages/domain/tests/evals.test.ts packages/domain/tests/golden-scenarios.test.ts packages/domain/tests/golden-fixtures.ts
  rtk git commit -m "test: assert golden behavior and state"
  ```

### Task 7: Add optional live-model evaluations

**Files:**

- Create: `scripts/eval-live-model.ts`
- Create: `scripts/eval-live-model.test.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add argument/config parsing tests**

  Require `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY`; default to 20
  non-mutating scenarios; cap concurrency at 3; redact keys and customer text
  from output.

- [ ] **Step 2: Implement an opt-in runner**

  The runner exercises provider decision quality against fixed tool fixtures,
  records structured pass/fail reasons and token usage, never connects to the
  production database, and exits non-zero below a 95% pass threshold.

- [ ] **Step 3: Keep live eval outside default CI**

  Add `eval:live`; do not call it from `pnpm test`. Document cost and exact
  environment isolation.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run scripts/eval-live-model.test.ts
  rtk git add scripts/eval-live-model.ts scripts/eval-live-model.test.ts package.json README.md
  rtk git commit -m "test: add isolated live model evaluation"
  ```

### Task 8: Phase 13 verification

**Files:**

- Modify: `docs/production-readiness.md`

- [ ] **Step 1: Run full phase gate**

  ```powershell
  rtk pnpm.cmd lint
  rtk pnpm.cmd typecheck
  rtk pnpm.cmd test
  rtk pnpm.cmd test:integration
  rtk pnpm.cmd build
  rtk git diff --check
  ```

- [ ] **Step 2: Record deterministic evidence**

  Record scenario totals, category totals, multi-turn count, failure-injection
  count, and the test command. Do not claim live-model quality unless the
  optional run was actually executed.

- [ ] **Step 3: Commit**

  ```powershell
  rtk git add docs/production-readiness.md
  rtk git commit -m "docs: record grounding evaluation evidence"
  ```

## Phase 13 Exit Criteria

- Cart, checkout, references, summary, and bounded messages reach the provider.
- “Mẫu 2” resolves using stored references in a two-turn test.
- Knowledge chunk IDs and commerce fact references are enforced by code.
- Unsupported model text is never sent.
- Tool traces contain safe useful projections instead of empty objects.
- Golden tests assert arguments, facts, state, handover, confirmation, and
  evidence rather than scripted tool names alone.
- Full phase gate is green.
