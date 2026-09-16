# Production Completion Execution Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this program plan-by-plan. Do not execute two plans that modify the same runtime flow concurrently.

**Goal:** Coordinate every remaining task required to turn the current Facebook sales-agent demo into a defensible release candidate.

**Architecture:** The program first makes inbound turns and outbound delivery durable, then fixes transactional commerce invariants, adds bounded multi-turn context and enforceable grounding, centralizes human control, replaces test-only production dependencies, and finally packages and certifies the exact deployable revision.

**Tech Stack:** TypeScript 5.9+, Node.js 22, pnpm 11.7, Fastify, BullMQ, Redis 7.4, PostgreSQL 16 with pgvector, Drizzle, Vitest, React/Vite, Docker Compose, Cloudflare Tunnel, OpenAI-compatible APIs.

**Spec:** `docs/superpowers/specs/2026-09-14-production-completion-design.md`

## Global Constraints

- Work from `C:\Users\ADMIN\Desktop\commerce-ai-agent` and obey `AGENTS.md`/`RTK.md`; prefix shell commands with `rtk`.
- Preserve the user's unrelated files and changes. Never use `git add .`, `git reset --hard`, `git clean`, or checkout over local work.
- Existing migrations `0001` through `0012` are immutable; use forward migrations beginning with `0013`.
- Never read, print, commit, or paste `.env` values. Tests use fake credentials and isolated databases.
- Use TDD: reproduce the failure, implement the narrowest complete behavior, rerun the focused test, then run the plan gate.
- One commit per task. Stage only the exact files listed by the task after checking `git status --short` and `git diff --check`.
- Do not push or deploy unless the user explicitly authorizes the current batch.
- Do not claim production success until the exact SHA is serving verified traffic.
- `NODE_ENV=production` must reject fake AI, fake Meta, deterministic embeddings, missing Admin authentication, and unsafe legacy options.
- All public inputs are parsed with strict Zod schemas; SQL stays parameterized; no raw model-generated SQL or executable content.
- All metrics/log labels are bounded and exclude message text, prompts, secrets, PSIDs, phone numbers, addresses, and email.
- The original fictional bakery data remains demo-only and must be labeled as such.

---

## Program Map

| Order | Plan                                                                                                   | Depends on        | Release value                                                                          |
| ----: | ------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------- |
|     1 | [Phase 11 — Turn and Delivery Reliability](2026-09-14-phase-11-turn-delivery-reliability.md)           | Current HEAD      | Prevents lost replies, duplicate mutation, and concurrent same-conversation processing |
|     2 | [Phase 12 — Commerce Transaction Integrity](2026-09-14-phase-12-commerce-transaction-integrity.md)     | Phase 11          | Enforces cart ownership and exact checkout consent                                     |
|     3 | [Phase 13 — Context, Grounding, and Evaluations](2026-09-14-phase-13-context-grounding-evaluations.md) | Phases 11–12      | Makes multi-turn selling work and prevents unsupported facts                           |
|     4 | [Phase 14 — Handover and Admin Security](2026-09-14-phase-14-handover-admin-security.md)               | Phases 11–13      | Makes human control authoritative and secures the operator surface                     |
|     5 | [Phase 15 — Production RAG and Observability](2026-09-14-phase-15-rag-observability-load.md)           | Phases 11–14      | Replaces fake retrieval and produces trustworthy operational evidence                  |
|     6 | [Phase 16 — Release and Demo Deployment](2026-09-14-phase-16-release-demo-deployment.md)               | All earlier plans | Builds, deploys, verifies, backs up, and records the exact release                     |

## Antigravity Operating Protocol

For every task:

1. Read the master spec, this index, the active phase plan, and the files named
   in that task.
2. Confirm `git status --short --branch` and record the current HEAD.
3. Run the focused pre-change test and preserve its output as red evidence.
4. Implement only that task's interface and acceptance criteria.
5. Run focused tests, then the phase gate.
6. Review the diff for secrets, PII logging, unintended files, migration edits,
   and cross-conversation authorization.
7. Commit only the task files with the supplied Conventional Commit intent.
8. Update the checkbox in the active plan only if the task commit exists and
   its gate is green.
9. If a test exposes a design contradiction, stop implementation, document the
   contradiction in the phase plan, and ask one precise question.
10. After a phase, write a handoff containing HEAD, commits, tests, migrations,
    remaining risks, and the exact next task.

## Copy-Paste Bootstrap Prompt for Antigravity

```text
Work in C:\Users\ADMIN\Desktop\commerce-ai-agent.

Your mission is to complete the Facebook Fanpage Sales Agent production-completion program. Read these files in full before changing code:
1. AGENTS.md and C:\Users\ADMIN\.codex\RTK.md
2. docs/superpowers/specs/2026-09-14-production-completion-design.md
3. docs/superpowers/plans/2026-09-14-production-completion-index.md
4. docs/superpowers/plans/2026-09-14-phase-11-turn-delivery-reliability.md

Start with Phase 11 Task 1 only. Follow TDD and every checkbox exactly. Reinspect current HEAD and dirty state; preserve unrelated files. Existing migrations 0001-0012 are immutable. Prefix shell commands with rtk. Never read or print real .env secrets. Never use git add ., reset --hard, clean, stash, push, deploy, or alter live Meta/Cloudflare configuration without explicit authority.

After each task: run focused tests, run the task gate, inspect git diff --check and git status, commit only the listed files, then continue automatically to the next task. After each phase: run the full phase gate and write a concise handoff with HEAD, commits, migrations, tests, risks, and the exact next task.

Stop and ask the user only when a human-required gate in the master spec is reached or when repository evidence proves a design contradiction. Ask exactly one concrete question with copy-paste instructions. Otherwise make the documented decision and continue.

Do not claim completion from green unit tests alone. Completion requires every phase exit criterion and the final exact-SHA deployment evidence in Phase 16.
```

## Required Cross-Phase Test Matrix

| Area        | Required proof                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Webhook     | signature, dedupe, redelivery, ordering, handler failure, process death boundary                     |
| Delivery    | persisted intent, retryable rejection, ambiguous result, terminal handover, outbound timeline        |
| Concurrency | same conversation serialized; different conversations concurrent; Admin takeover race                |
| Cart        | trusted scope, cross-customer denial, inventory validation, concurrent version changes               |
| Checkout    | multi-message fields, prepared summary, expiration, stale cart, price change, explicit confirmation  |
| Order       | one confirmation/one order, current price, inventory race, confirmed status, second order            |
| Grounding   | valid/invalid chunk IDs, insufficient evidence, transactional fact rendering, injection attempts     |
| Handover    | request/takeover/resolve/pause idempotency and consistent open-session state                         |
| Admin       | session expiration, rate limits, CSRF, origin checks, typed errors, audit records                    |
| RAG         | real provider contract, dimension mismatch, re-index, archived content exclusion                     |
| Operations  | complete metric emission, unique load runs, terminal DB counts, backup/restore, exact-SHA smoke test |

## Phase Gate Commands

Run after every phase from the repository root:

```powershell
rtk pnpm.cmd lint
rtk pnpm.cmd typecheck
rtk pnpm.cmd test
rtk pnpm.cmd test:integration
rtk pnpm.cmd build
rtk git diff --check
rtk git status --short --branch
```

PostgreSQL and Redis must be healthy before the integration command. The
integration global setup may only reset the exact isolated database named
`fanpage_sales_agent_test`.

## Human Checkpoints

Antigravity continues without asking for routine engineering choices. It stops
only for a secret/account action, final hostname confirmation, external backup
destination, real Page smoke-test input, or explicit push/deploy authorization.
The exact checkpoint instructions live in Phase 16.

## Final Program Acceptance

- Every checkbox in all six plans is complete.
- Every phase gate is green on the same HEAD.
- The source tree contains no unresolved placeholder or skipped release test.
- `docs/production-readiness.md` contains dated evidence and the deployed SHA.
- GitHub CI is green for that SHA.
- The Docker image digest and migration checksums are recorded.
- The public Cloudflare callback passes verification and signed POST smoke
  tests.
- A real Facebook test conversation proves grounded product/policy reply,
  handover suppression, cart mutation, prepared checkout summary, explicit
  confirmation, and exactly one confirmed order.
- Restore evidence proves the database can be recovered into a disposable
  instance.
