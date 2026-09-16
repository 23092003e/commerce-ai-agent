# Phase 14 Handover and Admin Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make human control and handover records transactionally consistent and replace the demonstrative Admin authentication path with a rate-limited, CSRF-protected session.

**Architecture:** A single conversation-control service owns every AI/human/paused transition under the same conversation lease used by workers. Fastify serves the production Admin application and authenticates it with signed short-lived cookies; mutation endpoints require CSRF and write structured audit records.

**Tech Stack:** TypeScript, PostgreSQL, Fastify, `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/static`, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-production-completion-design.md`

## Global Constraints

- Create `0015_admin_sessions_and_audit.sql`; do not edit prior migrations.
- Every control transition and send-time control check uses the Phase 11 lease.
- Returning to AI cannot leave an open handover.
- Entering human mode cannot omit an open handover.
- Raw admin secrets never enter browser storage, logs, metrics, or response
  bodies.
- Production permits no wildcard credentialed CORS.

---

### Task 1: Define typed domain and HTTP errors

**Files:**

- Create: `packages/domain/src/errors.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/tests/error-mapping.test.ts`

**Interfaces:**

- Produces the `DomainError` and `DomainErrorCode` contract from the master
  specification.

- [ ] **Step 1: Write table-driven mapping tests**

  Assert 404 for `not_found`; 409 for version/stale/consumed/expired conflicts;
  422 for invalid transition and ownership; 401/403/429 for auth, CSRF, and
  rate limit; and opaque 500 for unexpected errors.

- [ ] **Step 2: Verify current generic handler returns incorrect 500s**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/error-mapping.test.ts
  ```

- [ ] **Step 3: Implement typed error mapping**

  Log safe error code, method, route template, and trace ID. Never expose stack,
  SQL text, provider response body, or secret values.

- [ ] **Step 4: Replace string-matched expected errors in touched services**

  Convert checkout, cart, handover, and delivery error paths introduced in
  Phases 11–13. Unexpected programmer errors remain 500.

- [ ] **Step 5: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/error-mapping.test.ts
  rtk git add packages/domain/src/errors.ts packages/domain/src/index.ts apps/api/src/app.ts apps/api/tests/error-mapping.test.ts
  rtk git commit -m "feat: map typed domain failures"
  ```

### Task 2: Centralize handover and control transitions

**Files:**

- Create: `packages/domain/src/conversation-control.ts`
- Replace: `packages/db/src/handover-postgres.ts`
- Modify: `packages/db/src/postgres.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/domain/tests/conversation-control.test.ts`
- Test: `packages/db/tests/handover.integration.test.ts`

**Interfaces:**

- Produces `ConversationControlService` exactly as defined by the master spec.
- `requestHandover` is internally idempotent and does not accept a stale model
  version.

- [ ] **Step 1: Add invariant tests**

  Cover request twice, Admin takeover, return to AI, pause, stale Admin version,
  simultaneous agent/Admin transition, and resolution of all open records.
  After every operation assert:

  ```ts
  expect(openHandoverCount).toBe(controlMode === 'human' ? 1 : 0);
  ```

- [ ] **Step 2: Verify the current direct control endpoint violates invariants**

  ```powershell
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/handover.integration.test.ts
  ```

- [ ] **Step 3: Implement one locking transaction per transition**

  Admin calls acquire the conversation lease; worker/agent calls reuse the
  branded lease context received from Phase 11. Never reacquire the same lock
  through a second connection. Lock the conversation row, validate expected
  version for Admin commands, upsert/resolve handovers, change control mode,
  and increment version once.

- [ ] **Step 4: Remove direct repository control mutation from API wiring**

  Keep the low-level method private to the control repository. Agent, delivery,
  worker finalization, and Admin routes call the service.

- [ ] **Step 5: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/conversation-control.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/handover.integration.test.ts
  rtk git add packages/domain/src/conversation-control.ts packages/db/src/handover-postgres.ts packages/db/src/postgres.ts packages/db/src/index.ts packages/domain/tests/conversation-control.test.ts packages/db/tests/handover.integration.test.ts
  rtk git commit -m "fix: centralize conversation control transitions"
  ```

### Task 3: Enforce control mode immediately before delivery

**Files:**

- Modify: `packages/db/src/outbound-message-postgres.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Test: `apps/api/tests/agent-message-handler.test.ts`
- Test: `apps/api/tests/meta-pipeline.integration.test.ts`

**Interfaces:**

- `claimForSend` requires `conversationId` and atomically verifies current
  `control_mode = 'ai'` under the conversation lease.

- [ ] **Step 1: Add the takeover race test**

  Pause the handler after outbound planning, execute Admin takeover, release the
  handler, and assert zero channel sends, outbound state `failed` with safe code
  `human_controlled`, one open handover, and processed inbound event.

- [ ] **Step 2: Add paused-mode and return-to-AI tests**

  Paused mode suppresses sends without opening a new handover. A later inbound
  message after an explicit resolve may run AI normally; the old planned reply
  is never sent.

- [ ] **Step 3: Implement the final authoritative check**

  Check control mode inside the send claim, not from the stale context object.
  Complete the agent run as `no_action` or `handed_over` consistently.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/agent-message-handler.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts apps/api/tests/meta-pipeline.integration.test.ts
  rtk git add packages/db/src/outbound-message-postgres.ts apps/api/src/workers/agent-message-handler.ts apps/api/tests/agent-message-handler.test.ts apps/api/tests/meta-pipeline.integration.test.ts
  rtk git commit -m "fix: block AI delivery after human takeover"
  ```

### Task 4: Add signed Admin sessions, CSRF, and rate limits

**Files:**

- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/services/admin-session.ts`
- Create: `apps/api/src/routes/admin-session.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `.env.example`
- Test: `apps/api/tests/admin-auth.test.ts`
- Test: `apps/api/tests/admin-route.test.ts`

**Interfaces:**

- Produces `POST /internal/admin/session`, `DELETE /internal/admin/session`, and
  `GET /internal/admin/session`.
- Session cookie lifetime: 8 hours. CSRF header: `X-CSRF-Token`.

- [ ] **Step 1: Add authentication tests**

  Cover exact secret, bad secret, expired/tampered cookie, secure cookie in
  production, same-site strict, logout, missing/wrong CSRF, and legacy bearer
  rejection in production.

- [ ] **Step 2: Add rate-limit tests with an injected clock/IP**

  Assert login attempt six in 15 minutes returns 429; authenticated read 121 in
  one minute returns 429; mutation 31 returns 429. Verify safe response bodies
  and no secret echo.

- [ ] **Step 3: Install and register Fastify plugins**

  ```powershell
  rtk pnpm.cmd --filter @fanpage/api add @fastify/cookie @fastify/cors @fastify/rate-limit @fastify/static
  ```

  Register cookie before routes, rate limiting with explicit route scopes, CORS
  only for parsed `ADMIN_ALLOWED_ORIGINS`, and security headers on Admin/API
  responses.

- [ ] **Step 4: Implement stateless signed sessions**

  Session payload contains version, actor `demo-admin`, issued time, expiry, and
  random CSRF nonce. Sign with HMAC-SHA256 and timing-safe verification. Rotate
  session on login and clear it on logout.

- [ ] **Step 5: Add strict production config validation**

  Require a 32+ character `ADMIN_AUTH_SECRET`; parse comma-separated HTTPS
  `ADMIN_ALLOWED_ORIGINS`; permit localhost HTTP only outside production; and
  default `ADMIN_LEGACY_BEARER_ENABLED=false`.

- [ ] **Step 6: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/admin-auth.test.ts apps/api/tests/admin-route.test.ts
  rtk git add apps/api/package.json pnpm-lock.yaml apps/api/src/services/admin-session.ts apps/api/src/routes/admin-session.ts apps/api/src/app.ts packages/config/src/index.ts .env.example apps/api/tests/admin-auth.test.ts apps/api/tests/admin-route.test.ts
  rtk git commit -m "feat: secure admin sessions and limits"
  ```

### Task 5: Serve Admin from the API and remove browser secret storage

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/admin/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/admin/src/App.test.tsx`
- Test: `apps/api/tests/admin-route.test.ts`

**Interfaces:**

- Production Admin base path is `/admin`; API calls use same-origin relative
  URLs and `credentials: 'same-origin'`.

- [ ] **Step 1: Add UI tests**

  Verify the raw secret is submitted only to session creation, is never written
  to local/session storage, successful login clears the input, mutation requests
  carry CSRF, 401 returns to login, and 409 displays refresh guidance.

  Install the test-only browser dependencies before writing the test:

  ```powershell
  rtk pnpm.cmd --filter admin add -D @testing-library/react @testing-library/user-event jsdom
  ```

  Mark the test with `// @vitest-environment jsdom` so the root Vitest run uses
  a browser-like environment only for this file.

- [ ] **Step 2: Add static-serving tests**

  `/admin` and client-side Admin routes return the built index; `/internal` and
  `/webhooks` never fall through to the SPA; static asset paths use immutable
  cache headers.

- [ ] **Step 3: Configure Vite base and same-origin API client**

  Use `base: '/admin/'`. Centralize fetch behavior in a small Admin API module
  rather than repeating auth/error parsing in `App.tsx`.

- [ ] **Step 4: Serve the built Admin directory only in production**

  Resolve the path from `import.meta.url`; startup fails with a clear error if
  production assets are missing. Development retains Vite and the explicit
  allowlisted API origin.

- [ ] **Step 5: Run tests/build and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/admin/src/App.test.tsx apps/api/tests/admin-route.test.ts
  rtk pnpm.cmd --filter admin build
  rtk pnpm.cmd --filter @fanpage/api build
  rtk git add apps/api/src/app.ts apps/api/src/main.ts apps/admin/src/App.tsx apps/admin/vite.config.ts apps/admin/package.json pnpm-lock.yaml apps/admin/src/App.test.tsx apps/api/tests/admin-route.test.ts
  rtk git commit -m "feat: serve secure same-origin admin desk"
  ```

### Task 6: Add complete Admin mutation audit records

**Files:**

- Create: `packages/db/migrations/0015_admin_sessions_and_audit.sql`
- Create: `packages/db/src/audit-postgres.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/handover-postgres.ts`
- Modify: `packages/db/src/admin-postgres.ts`
- Modify: `packages/db/src/order-postgres.ts`
- Modify: `apps/api/src/app.ts`
- Test: `packages/db/tests/admin-audit.integration.test.ts`
- Test: `packages/db/tests/order.integration.test.ts`

**Interfaces:**

- Produces `AdminAuditRepository.record(tx, { actor, action, targetType,
targetId, before, after })` for use inside the mutation transaction.

- [ ] **Step 1: Add audit tests**

  Cover takeover, resolve, pause, knowledge ingest/archive, and current order
  creation. Assert failed/conflicted operations create no success audit.
  Assert projections omit phone, address, tokens, content bodies, and prompts.

- [ ] **Step 2: Add audit table to the forward migration**

  Store actor, action, target type/ID, bounded JSON projections, trace ID, and
  timestamp. Revoke anonymous/authenticated access and index target/time.

- [ ] **Step 3: Record audits in the same transaction as mutations**

  If audit insertion fails, the mutation rolls back. Order creation records
  actor `system:agent` and action `order.create` inside the order transaction.
  Read-only Admin routes do not create audit rows.

- [ ] **Step 4: Run tests and commit**

  ```powershell
  rtk pnpm.cmd db:migrate
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/admin-audit.integration.test.ts packages/db/tests/handover.integration.test.ts packages/db/tests/order.integration.test.ts
  rtk git add packages/db/migrations/0015_admin_sessions_and_audit.sql packages/db/src/audit-postgres.ts packages/db/src/index.ts packages/db/src/handover-postgres.ts packages/db/src/admin-postgres.ts packages/db/src/order-postgres.ts apps/api/src/app.ts packages/db/tests/admin-audit.integration.test.ts packages/db/tests/order.integration.test.ts
  rtk git commit -m "feat: audit admin state mutations"
  ```

### Task 7: Phase 14 verification

**Files:**

- Modify: `README.md`
- Modify: `docs/production-readiness.md`
- Create: `docs/runbooks/admin-access.md`

- [ ] **Step 1: Document session login, logout, rotation, lockout, CSRF, and emergency revocation**

- [ ] **Step 2: Run the full phase gate**

  ```powershell
  rtk pnpm.cmd lint
  rtk pnpm.cmd typecheck
  rtk pnpm.cmd test
  rtk pnpm.cmd test:integration
  rtk pnpm.cmd build
  rtk git diff --check
  ```

- [ ] **Step 3: Commit documentation**

  ```powershell
  rtk git add README.md docs/production-readiness.md docs/runbooks/admin-access.md
  rtk git commit -m "docs: define secure admin operations"
  ```

## Phase 14 Exit Criteria

- Conversation control mode and open handover count cannot diverge.
- Human takeover wins the race before outbound send.
- Expected domain conflicts return typed 4xx responses, not generic 500.
- Admin secret never persists in browser storage.
- Session expiration, CSRF, origin policy, and route rate limits are tested.
- Production Admin is same-origin and all mutations are safely audited.
- Full phase gate is green.
