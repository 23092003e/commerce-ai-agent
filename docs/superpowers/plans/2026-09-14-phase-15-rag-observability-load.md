# Phase 15 Production RAG, Observability, and Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace test-only retrieval in production, emit every required operational signal, and make load evidence represent complete processed turns.

**Architecture:** Tests keep deterministic embeddings while production selects an explicit OpenAI-compatible embedding adapter and refuses unsafe fallback. Prometheus metrics provide aggregation while structured logs preserve bounded event detail; a unique-run load harness reconciles HTTP, queue, database, agent, outbound, and handover outcomes.

**Tech Stack:** TypeScript, PostgreSQL/pgvector, OpenAI-compatible embeddings, `prom-client`, Fastify, BullMQ, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-production-completion-design.md`

## Global Constraints

- Create `0016_knowledge_embedding_metadata.sql`; do not edit prior migrations.
- Deterministic embeddings are prohibited in production.
- Provider/model/dimensions are explicit and validated before serving traffic.
- Metrics never label PII, prompts, message text, raw errors, or unbounded IDs.
- Load success requires terminal database reconciliation, not only HTTP 2xx.
- Tests never spend real provider credits unless the explicit live command runs.

---

### Task 1: Add production embedding configuration and adapter

**Files:**

- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/tests/config.test.ts`
- Create: `packages/domain/src/openai-embedding-provider.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `.env.example`
- Test: `packages/domain/tests/openai-embedding-provider.test.ts`

**Interfaces:**

- Produces:

  ```ts
  createOpenAiEmbeddingProvider(input: {
    apiKey: string;
    model: string;
    baseUrl: string;
    dimensions: number;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }): EmbeddingProvider;
  ```

- [ ] **Step 1: Add config failure tests**

  Production must reject missing embedding provider/key/model/base URL,
  deterministic provider, invalid dimensions, non-HTTPS remote URLs, and
  placeholder secrets. Test permits localhost HTTP only outside production.

- [ ] **Step 2: Add adapter contract tests**

  Cover request URL/body, bearer header, timeout, non-2xx response, malformed
  vector, incorrect dimensions, non-finite values, and successful normalized
  result. Fake fetch only; no network.

- [ ] **Step 3: Run tests and verify red**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/config/tests/config.test.ts packages/domain/tests/openai-embedding-provider.test.ts
  ```

- [ ] **Step 4: Implement strict configuration**

  Add `EMBEDDING_PROVIDER=deterministic|openai-compatible`,
  `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, and
  `EMBEDDING_DIMENSIONS`. Use a 10-second timeout and never log response bodies.

- [ ] **Step 5: Wire the selected provider**

  Test/development may choose deterministic explicitly. Production constructs
  only the real adapter. Keep AI decision and embedding credentials separate.

- [ ] **Step 6: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/config/tests/config.test.ts packages/domain/tests/openai-embedding-provider.test.ts packages/domain/tests/knowledge-service.test.ts
  rtk git add packages/config/src/index.ts packages/config/tests/config.test.ts packages/domain/src/openai-embedding-provider.ts packages/domain/src/index.ts apps/api/src/main.ts .env.example packages/domain/tests/openai-embedding-provider.test.ts
  rtk git commit -m "feat: configure production embeddings"
  ```

### Task 2: Track embedding provenance and safe re-indexing

**Files:**

- Create: `packages/db/migrations/0016_knowledge_embedding_metadata.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/domain/src/knowledge.ts`
- Modify: `packages/db/src/knowledge-postgres.ts`
- Test: `packages/db/tests/knowledge.integration.test.ts`

**Interfaces:**

- `PreparedKnowledgeDocument` adds `embeddingProvider` and `embeddingModel`.
- Search selects only active documents matching configured provider, model, and
  dimensions.

- [ ] **Step 1: Add provenance and mismatch tests**

  Assert ingestion records provider/model/dimensions; same content with a new
  model creates a new version; incompatible vectors never join one query; and
  archived/old-provider documents are excluded from production search.

- [ ] **Step 2: Add forward migration and safe historical values**

  Backfill existing rows as provider `deterministic`, model `legacy-8d`. Add
  non-null provider/model columns and nullable `normalized_content` for future
  safe re-indexing. Existing rows remain null and require source re-import; do
  not reconstruct source text from overlapping chunks. Keep the existing 8-D
  partial index and add a 1536-D partial HNSW index for the documented default;
  other validated dimensions remain correct via filtered exact search until a
  forward migration adds their tuned index. Do not rewrite historical vectors.

- [ ] **Step 3: Update ingestion/version identity**

  Version/dedupe identity includes source key, content hash, provider, model,
  and dimensions. A new real embedding version archives the previous active
  version only after every chunk is stored successfully.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd db:migrate
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/knowledge.integration.test.ts
  rtk git add packages/db/migrations/0016_knowledge_embedding_metadata.sql packages/db/src/schema.ts packages/domain/src/knowledge.ts packages/db/src/knowledge-postgres.ts packages/db/tests/knowledge.integration.test.ts
  rtk git commit -m "feat: version knowledge embedding provenance"
  ```

### Task 3: Add a controlled knowledge re-index command

**Files:**

- Create: `scripts/reindex-knowledge.ts`
- Create: `scripts/reindex-knowledge.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Adds `pnpm knowledge:reindex -- --source-provider deterministic --dry-run`
  and explicit `--execute` mode.

- [ ] **Step 1: Test dry-run and safety parsing**

  Require mutually exclusive `--dry-run`/`--execute`, bounded batch size 1–50,
  configured destination provider, and refusal to target the same provenance.
  Output IDs/counts only.

- [ ] **Step 2: Implement resumable batch re-index**

  Read approved active source documents that retain `normalized_content`, ingest
  through the configured provider, checkpoint by source key, and archive old
  versions only after successful new ingestion. Report legacy rows without
  source content as `requires_source_reimport`; never rebuild them from
  overlapping chunks. A failed batch leaves old active content searchable.

- [ ] **Step 3: Test interrupted resume with fake repositories**

  Fail batch two, rerun, and assert batch one is deduplicated and no document is
  left without an active version.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run scripts/reindex-knowledge.test.ts
  rtk git add scripts/reindex-knowledge.ts scripts/reindex-knowledge.test.ts package.json README.md
  rtk git commit -m "feat: add safe knowledge reindex command"
  ```

### Task 4: Replace log-only metrics with Prometheus instruments

**Files:**

- Modify: `packages/observability/package.json`
- Modify: `pnpm-lock.yaml`
- Replace: `packages/observability/src/metrics.ts`
- Modify: `packages/observability/src/index.ts`
- Test: `packages/observability/tests/metrics.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Produces typed `OperationalMetrics` methods plus protected
  `GET /internal/metrics`.

- [ ] **Step 1: Add metric registration tests**

  Assert one counter/histogram/gauge per master-spec metric family, stable
  bucket configuration, duplicate registry construction safety, allowlisted
  labels, and rejection of unknown names/non-finite observations.

- [ ] **Step 2: Install `prom-client`**

  ```powershell
  rtk pnpm.cmd --filter @fanpage/observability add prom-client
  ```

- [ ] **Step 3: Implement typed instruments**

  Use counters for outcomes, histograms for duration/token observations, and
  gauges for queue states. Keep structured metric logs only if they add
  incident context; do not double-count.

- [ ] **Step 4: Protect metrics endpoint**

  Accept an authenticated Admin session or exact timing-safe
  `METRICS_AUTH_SECRET`. Return Prometheus content type and disable public cache.

- [ ] **Step 5: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/observability/tests/metrics.test.ts apps/api/tests/admin-auth.test.ts
  rtk git add packages/observability/package.json pnpm-lock.yaml packages/observability/src/metrics.ts packages/observability/src/index.ts packages/observability/tests/metrics.test.ts apps/api/src/app.ts
  rtk git commit -m "feat: expose bounded operational metrics"
  ```

### Task 5: Instrument every required lifecycle boundary

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/services/webhook-ingestion.ts`
- Modify: `apps/api/src/workers/inbound-message-worker.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Modify: `packages/domain/src/agent-orchestrator.ts`
- Modify: `packages/domain/src/knowledge.ts`
- Modify: `packages/domain/src/checkout-order.ts`
- Modify: `packages/db/src/order-postgres.ts`
- Modify: `packages/queue/src/index.ts`
- Test: `apps/api/tests/operational-metrics.test.ts`

**Interfaces:**

- Consumes the typed metric service from Task 4.

- [ ] **Step 1: Write one failing emission test per required family**

  Cover accepted/duplicate/rejected webhook events, whole-turn duration,
  provider error/tokens, tool error/duration, send state, handover reason, RAG
  evidence/no-evidence, checkout start/prepare/stale/consume, order
  create/replay, and queue states.

- [ ] **Step 2: Instrument at the authoritative boundary**

  Increment order only after commit; handover only after transaction success;
  webhook duplicate from repository result; and full-turn duration only after
  terminal state. Avoid counting retries as new business outcomes.

- [ ] **Step 3: Add trace correlation to structured logs**

  Carry trace ID, webhook event ID, conversation ID, inbound message ID, agent
  run ID, and outbound message ID as bounded log fields. Hash or omit provider
  customer identifiers.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/operational-metrics.test.ts packages/observability/tests/metrics.test.ts
  rtk git add apps/api/src/app.ts apps/api/src/services/webhook-ingestion.ts apps/api/src/workers/inbound-message-worker.ts apps/api/src/workers/agent-message-handler.ts packages/domain/src/agent-orchestrator.ts packages/domain/src/knowledge.ts packages/domain/src/checkout-order.ts packages/db/src/order-postgres.ts packages/queue/src/index.ts apps/api/tests/operational-metrics.test.ts
  rtk git commit -m "feat: instrument complete sales turn outcomes"
  ```

### Task 6: Make the load harness unique and end-to-end

**Files:**

- Modify: `scripts/load-runner.ts`
- Modify: `scripts/load-webhook-fixture.ts`
- Modify: `scripts/load-runner.test.ts`
- Create: `scripts/load-webhook-fixture.test.ts`
- Modify: `README.md`

**Interfaces:**

- Produces a JSON summary containing run ID, HTTP accepted/rejected, terminal
  processed/replied/handed-over/failed/duplicate totals, and p50/p95/p99 for HTTP
  acknowledgment and complete-turn latency.

- [ ] **Step 1: Add unique-ID tests**

  Inject a UUID factory and assert two runs with identical counts never share a
  sender or message ID. IDs use `load-<runId>-<index>`.

- [ ] **Step 2: Add response-body validation tests**

  Require HTTP 200 plus JSON `{accepted: 1}` for each unique request. Treat
  malformed body, zero accepted, timeout, or non-2xx as failure.

- [ ] **Step 3: Add terminal reconciliation**

  Poll the isolated database by run-ID prefix until every message has a
  processed event and terminal agent outcome, or a configurable 60-second
  deadline expires. Query status counts without reading message text.

- [ ] **Step 4: Measure both acknowledgment and terminal latency**

  Store receipt start per message and terminal timestamps from database rows.
  Calculate nearest-rank p50/p95/p99. Report queue/AI/send failures separately.

- [ ] **Step 5: Add safe command guards**

  Default target is localhost and test database. A non-local URL requires
  `--allow-remote` plus `--run-label`; production database names are rejected.

- [ ] **Step 6: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run scripts/load-runner.test.ts scripts/load-webhook-fixture.test.ts
  rtk git add scripts/load-runner.ts scripts/load-webhook-fixture.ts scripts/load-runner.test.ts scripts/load-webhook-fixture.test.ts README.md
  rtk git commit -m "test: reconcile end-to-end webhook load"
  ```

### Task 7: Phase 15 verification and readiness evidence

**Files:**

- Modify: `docs/runbooks/monitoring.md`
- Modify: `docs/production-readiness.md`

- [ ] **Step 1: Run the full phase gate**

  ```powershell
  rtk pnpm.cmd lint
  rtk pnpm.cmd typecheck
  rtk pnpm.cmd test
  rtk pnpm.cmd test:integration
  rtk pnpm.cmd build
  rtk git diff --check
  ```

- [ ] **Step 2: Run local fake-provider load evidence**

  ```powershell
  rtk pnpm.cmd load:webhook -- --count 100 --concurrency 10
  ```

  Acceptance: 100 unique HTTP accepts, 100 terminal turns, zero failed or
  unaccounted rows, and recorded acknowledgment/terminal p50/p95/p99.

- [ ] **Step 3: Document metric queries and alert thresholds**

  Include exact PromQL for error rates, unknown delivery, failed queue jobs,
  RAG no-evidence, stale checkout, and order conversion. Identify the operator
  action for each alert.

- [ ] **Step 4: Commit evidence without secrets or customer text**

  ```powershell
  rtk git add docs/runbooks/monitoring.md docs/production-readiness.md
  rtk git commit -m "docs: record retrieval and load readiness"
  ```

## Phase 15 Exit Criteria

- Production cannot start with deterministic embeddings.
- Knowledge versions record and enforce provider/model/dimension provenance.
- Re-index is resumable and never removes the last valid active version.
- Every master-spec metric is emitted at an authoritative boundary.
- Load runs use unique IDs, validate accepted counts, wait for terminal turns,
  and report end-to-end p50/p95/p99.
- Full phase gate and 100-message local reconciliation are green.
