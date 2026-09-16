# Phase 16 Release and Zero-Cost Demo Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package, verify, back up, and deploy the exact release candidate on the existing Windows/Docker/Cloudflare setup without committing secrets.

**Architecture:** A multi-stage non-root image builds the API and same-origin Admin assets. Docker Compose starts PostgreSQL/pgvector and Redis with persistent volumes, runs immutable migrations, then starts the API/worker; the installed Cloudflare Tunnel publishes only the HTTPS application hostname.

**Tech Stack:** Docker Desktop, Docker Compose, Node.js 22, pnpm 11.7, PostgreSQL 16/pgvector, Redis 7.4, Cloudflare Tunnel, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-production-completion-design.md`

## Global Constraints

- The zero-cost target is a demonstration deployment, not high availability.
- PostgreSQL and Redis ports are not published publicly in production.
- Runtime secrets come from an untracked environment file or OS secret store.
- The exact Git SHA, image digest, migration checksums, and smoke-test evidence
  identify a deployment.
- CI success alone is not deployment success; the exact SHA must serve traffic.
- Push/deploy requires explicit authorization for the current batch.

---

### Task 1: Add reproducible production images

**Files:**

- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `package.json`
- Test: `scripts/container-smoke.test.ts`

**Interfaces:**

- Image exposes port 3000, runs as an unprivileged user, serves `/health`,
  `/ready`, `/webhooks/meta`, `/internal`, and `/admin`.

- [ ] **Step 1: Add a static container contract test**

  Parse the Dockerfile and assert pinned Node major 22, frozen pnpm install,
  separate build/runtime stages, non-root `USER`, production environment,
  healthcheck, and no source `.env` copy.

- [ ] **Step 2: Create the multi-stage Dockerfile**

  Builder installs with `pnpm install --frozen-lockfile`, builds all packages,
  and prunes production dependencies. Runtime copies only built output,
  production dependencies, package metadata, and migration SQL required by the
  migration command.

- [ ] **Step 3: Create a strict `.dockerignore`**

  Exclude `.git`, `.env*` except `.env.example`, node_modules, coverage,
  local data, graph outputs, editor files, test results, and attachments.

- [ ] **Step 4: Build and inspect the image**

  ```powershell
  rtk docker build --pull -t fanpage-sales-agent:local .
  rtk docker image inspect fanpage-sales-agent:local
  ```

  Confirm non-root config, port 3000, healthcheck, and no environment secrets.

- [ ] **Step 5: Run focused test and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run scripts/container-smoke.test.ts
  rtk git add Dockerfile .dockerignore apps/api/src/app.ts apps/api/src/main.ts package.json scripts/container-smoke.test.ts
  rtk git commit -m "feat: package production application image"
  ```

### Task 2: Add a safe production Compose profile

**Files:**

- Modify: `docker-compose.yml`
- Create: `docker-compose.production.yml`
- Create: `.env.production.example`
- Modify: `.gitignore`
- Test: `scripts/compose-config.test.ts`

**Interfaces:**

- Services: `postgres`, `redis`, one-shot `migrate`, and `api`.
- Only API binds `127.0.0.1:3000:3000` for Cloudflare Tunnel.

- [ ] **Step 1: Add Compose policy tests**

  Render merged config and assert no database/Redis host ports, named volumes,
  healthchecks, `restart: unless-stopped`, resource limits, dependency health
  conditions, read-only API filesystem where practical, and no literal secret.

- [ ] **Step 2: Add production services**

  `migrate` uses the exact application image and exits successfully before API
  start. PostgreSQL uses pgvector 0.8.1/PG16 and a named volume; Redis enables
  append-only persistence and a named volume. API receives secret variable
  names without defaults containing credentials.

- [ ] **Step 3: Add an environment template with validation notes**

  List every required key with empty values, safe descriptions, production
  adapters, expected HTTPS Admin origin, and secret-generation commands that do
  not print existing values. Add `!.env.production.example` to `.gitignore` so
  the template is tracked while real `.env.production` remains ignored.

- [ ] **Step 4: Validate config and boot with generated test secrets**

  Use a temporary untracked environment file, run merged Compose config, start
  the stack, wait for health, call `/health` and `/ready`, then stop the test
  stack without removing named production volumes.

- [ ] **Step 5: Run test and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run scripts/compose-config.test.ts
  rtk git add docker-compose.yml docker-compose.production.yml .env.production.example .gitignore scripts/compose-config.test.ts
  rtk git commit -m "feat: define persistent demo deployment stack"
  ```

### Task 3: Strengthen CI and release evidence

**Files:**

- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-candidate.yml`
- Create: `scripts/verify-release.ts`
- Create: `scripts/verify-release.test.ts`
- Modify: `package.json`

**Interfaces:**

- Adds `pnpm verify:release` and a manual release-candidate workflow that builds
  an image for the triggering SHA without deploying it.

- [ ] **Step 1: Add release verifier tests**

  Fail on dirty tracked files, missing spec/plans, non-main target unless
  explicitly allowed, uncommitted migrations, missing test evidence, fake
  production adapters, placeholder secrets, or mismatched image SHA label.

- [ ] **Step 2: Harden CI permissions and concurrency**

  Set read-only contents permission, cancel superseded branch runs, pin Node and
  pnpm, retain Postgres/Redis health checks, and run lint, typecheck, unit,
  migration, integration, build, `pnpm audit --audit-level high`, and container
  contract tests.

- [ ] **Step 3: Add release-candidate workflow**

  Manual dispatch checks out the selected immutable SHA, reruns all gates,
  builds the image with OCI revision label, exports image digest and test report
  as artifacts, and performs no deployment or secret retrieval.

- [ ] **Step 4: Test verifier and inspect workflow syntax**

  ```powershell
  rtk pnpm.cmd exec vitest run scripts/verify-release.test.ts
  rtk pnpm.cmd verify:release -- --allow-dirty-docs
  ```

- [ ] **Step 5: Commit**

  ```powershell
  rtk git add .github/workflows/ci.yml .github/workflows/release-candidate.yml scripts/verify-release.ts scripts/verify-release.test.ts package.json
  rtk git commit -m "ci: certify immutable release candidates"
  ```

### Task 4: Implement backup and restore verification

**Files:**

- Create: `scripts/backup-postgres.ps1`
- Create: `scripts/restore-postgres.ps1`
- Create: `scripts/verify-backup.ps1`
- Create: `docs/runbooks/backup-restore.md`
- Test: `scripts/backup-scripts.test.ts`

**Interfaces:**

- Backup output is timestamped custom-format `pg_dump` plus SHA-256 checksum and
  metadata containing source schema version and Git SHA.
- Restore always targets a separately named disposable database unless the user
  passes a typed production confirmation outside automation.

- [ ] **Step 1: Add script safety tests**

  Assert literal paths, no broad deletion, refusal to overwrite existing
  backup, refusal to restore into `fanpage_sales_agent`, checksum validation,
  and redaction of connection passwords.

- [ ] **Step 2: Implement backup**

  Resolve and validate the destination below a user-supplied backup directory,
  run `pg_dump --format=custom`, hash output, and write metadata. Never embed
  credentials in command output.

- [ ] **Step 3: Implement disposable restore and verification**

  Create a uniquely named `fanpage_sales_agent_restore_<timestamp>` database,
  restore, verify migrations/checksums plus row counts for core tables, and
  leave cleanup as an explicit validated operation.

- [ ] **Step 4: Perform one local restore drill**

  Record duration, checksum, migration count, safe table counts, and result in
  the runbook. The backup destination must be confirmed by the user before this
  step if none has been supplied.

- [ ] **Step 5: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run scripts/backup-scripts.test.ts
  rtk git add scripts/backup-postgres.ps1 scripts/restore-postgres.ps1 scripts/verify-backup.ps1 scripts/backup-scripts.test.ts docs/runbooks/backup-restore.md
  rtk git commit -m "ops: verify database backup and restore"
  ```

### Task 5: Write exact deploy, rollback, and Cloudflare procedures

**Files:**

- Replace: `docs/runbooks/deploy.md`
- Create: `docs/runbooks/cloudflare-tunnel.md`
- Modify: `docs/runbooks/incident-retry.md`
- Modify: `docs/runbooks/monitoring.md`
- Modify: `README.md`

- [ ] **Step 1: Document pre-deploy checks**

  Include clean tracked state, exact SHA, green GitHub run, image digest,
  migration checksum, backup success, production adapter validation, Page token
  age/permissions, and current `/ready` evidence.

- [ ] **Step 2: Document Windows deployment commands**

  Use explicit repository paths, production Compose files, pull/build, one-shot
  migration, health wait, and API start. Do not place secrets on the command
  line or in the runbook.

- [ ] **Step 3: Document Cloudflare routing**

  Route the confirmed API hostname to `http://127.0.0.1:3000`, expose Admin on
  `/admin`, keep Postgres/Redis private, verify the installed `Cloudflared`
  service, and test certificate/HTTPS behavior.

- [ ] **Step 4: Document rollback boundaries**

  Roll back application image to a recorded digest. Never reverse an applied
  migration by editing SQL; use a forward repair or database restore. Include
  criteria for disabling Meta subscription and switching conversation control
  to human.

- [ ] **Step 5: Document token rotation and incident ownership**

  Cover Meta Page token, app secret/webhook signature impact, OpenRouter key,
  embedding key, Admin secret/session invalidation, and metrics secret.

- [ ] **Step 6: Commit documentation**

  ```powershell
  rtk git add docs/runbooks/deploy.md docs/runbooks/cloudflare-tunnel.md docs/runbooks/incident-retry.md docs/runbooks/monitoring.md README.md
  rtk git commit -m "docs: define exact demo deployment operations"
  ```

### Task 6: Run final local release certification

**Files:**

- Modify: `docs/production-readiness.md`
- Create: `docs/releases/2026-09-release-candidate.md`

- [ ] **Step 1: Verify repository and secret hygiene**

  ```powershell
  rtk git status --short --branch
  rtk git diff --check
  rtk git grep -n -I -E "(EAA[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{20,}|META_PAGE_ACCESS_TOKEN=.+|AI_API_KEY=.+|ADMIN_AUTH_SECRET=.+)"
  ```

  Expected: only documented placeholders, never real values.

- [ ] **Step 2: Run the complete clean-install gate**

  ```powershell
  rtk pnpm.cmd install --frozen-lockfile
  rtk pnpm.cmd lint
  rtk pnpm.cmd typecheck
  rtk pnpm.cmd test
  rtk pnpm.cmd db:migrate
  rtk pnpm.cmd test:integration
  rtk pnpm.cmd build
  rtk pnpm.cmd verify:release
  ```

- [ ] **Step 3: Run deterministic fault and load evidence**

  Execute the named fault suites from Phases 11–14 and the 100-message Phase 15
  load. Record commands, counts, p50/p95/p99, and zero unaccounted events.

- [ ] **Step 4: Build the exact candidate image**

  Tag with full SHA, inspect OCI revision label, record digest, boot the stack,
  and verify local health, readiness, Admin login/logout, and metrics auth.

- [ ] **Step 5: Perform disposable backup restore**

  Record checksum, duration, schema migration count, and verification result.

- [ ] **Step 6: Write release evidence**

  Include candidate SHA, commit list by phase, test totals, migration checksums,
  image digest, load results, restore results, known zero-cost hosting limits,
  and all uncompleted human gates. Do not include secrets or PII.

- [ ] **Step 7: Commit release evidence**

  ```powershell
  rtk git add docs/production-readiness.md docs/releases/2026-09-release-candidate.md
  rtk git commit -m "docs: record local release certification"
  ```

### Task 7: Human checkpoint — push and external configuration

**Files:** None.

- [ ] **Step 1: Ask for push authorization**

  Report exact HEAD, commits to push, clean/dirty state, test totals, and remote
  branch. Ask one question: permission to push that exact HEAD to `origin/main`.

- [ ] **Step 2: Push only after explicit approval**

  ```powershell
  rtk git push origin main
  ```

- [ ] **Step 3: Wait for GitHub CI on the exact SHA**

  Record workflow URL/status if GitHub tooling is available. A green older SHA
  does not satisfy this gate.

- [ ] **Step 4: Ask for external secret/config actions one at a time**

  Required values/actions are entered by the user directly into the untracked
  production environment or provider dashboard: Meta credentials, AI key/model,
  embedding key/model/dimensions, Admin secret, metrics secret, Cloudflare
  hostname, Meta Live/App Review state, and Page `messages` subscription.

### Task 8: Deploy and verify real traffic

**Files:**

- Modify: `docs/releases/2026-09-release-candidate.md`
- Modify: `docs/production-readiness.md`

- [ ] **Step 1: Obtain explicit deployment authorization**

  State the exact SHA, image digest, target machine, hostname, migration list,
  backup path/checksum, rollback image, and expected brief service impact.

- [ ] **Step 2: Deploy the exact image and run migrations**

  Follow the committed deploy runbook. Do not rebuild from a different or dirty
  checkout. Wait for local `/ready` before relying on Cloudflare.

- [ ] **Step 3: Verify public infrastructure**

  Check HTTPS certificate, `GET /health`, `GET /ready`, Meta webhook GET
  challenge, rejection of an invalid signature, Admin route protection, and
  absence of public PostgreSQL/Redis ports.

- [ ] **Step 4: Ask the user to send four real test conversations**

  Request one action at a time: product question, approved policy question,
  human takeover, and a test order with explicit confirmation. Use only fake
  customer/order data.

- [ ] **Step 5: Reconcile each real test**

  Prove webhook event, inbound message, agent run, tool/evidence ledger,
  outbound state, handover/control state, cart/confirmation, and exactly one
  confirmed order. Verify no PII appears in logs/metrics.

- [ ] **Step 6: Record serving revision and close readiness**

  Add deployed SHA/image digest, UTC deployment time, public smoke results,
  manual Meta evidence, and rollback reference. Mark ready only if every manual
  and automated gate is complete.

- [ ] **Step 7: Commit evidence and request permission before final push**

  ```powershell
  rtk git add docs/releases/2026-09-release-candidate.md docs/production-readiness.md
  rtk git commit -m "docs: record deployed release evidence"
  ```

## Phase 16 Exit Criteria

- Reproducible non-root image and safe persistent Compose stack exist.
- GitHub CI and release certification are green for the exact candidate SHA.
- Backup restores successfully into a disposable database.
- Cloudflare exposes only the API/Admin HTTPS surface.
- Real Page tests reconcile from webhook to terminal outcome and confirmed
  order.
- Deployment evidence records exact SHA, image digest, migration checksums,
  backup checksum, and rollback target.
- No manual readiness item remains unverified.
