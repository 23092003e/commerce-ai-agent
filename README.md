# Facebook Fanpage AI Sales Agent

Production-oriented TypeScript monorepo for a Facebook Messenger commerce agent. The current milestone implements Phase 0 and the testable Phase 1 skeleton only: secure Meta webhook ingress, durable event storage, Redis queueing, idempotent inbound-message persistence, and fake/Graph outbound text adapters. It deliberately contains no AI sales logic yet.

## Prerequisites

- Node.js 22 or newer
- pnpm 11.7.0
- Docker Desktop with Linux containers

## Local setup (PowerShell)

```powershell
pnpm.cmd install
Copy-Item -LiteralPath .env.example -Destination .env
docker compose up -d postgres redis
pnpm.cmd db:migrate
pnpm.cmd dev
```

Before starting the API, replace `META_APP_SECRET` and `META_VERIFY_TOKEN` in `.env` with local values of at least 16 characters. `META_ADAPTER=fake` and `AI_PROVIDER=fake` require no real Meta or AI credentials.

The API listens on `http://localhost:3000` by default:

```text
GET  /health
GET  /ready
GET  /webhooks/meta
POST /webhooks/meta
```

Send the checked-in Messenger fixture through the real local HTTP/queue/worker pipeline:

```powershell
pnpm.cmd fixture:send
```

The fixture sender signs the exact raw JSON bytes with the local app secret. Change its Meta message ID before re-sending if you want a new event; identical IDs are intentionally deduplicated.

## Quality commands

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd build
```

`pnpm test:integration` expects healthy PostgreSQL and Redis services. It executes the signed fixture through Fastify, PostgreSQL, BullMQ, and the worker, then asserts the message is persisted exactly once.

## Runtime flow

```text
Meta webhook
  -> raw-body HMAC verification
  -> Zod payload validation
  -> durable webhook_events insert/dedupe
  -> BullMQ enqueue with deterministic job ID
  -> worker normalization
  -> PostgreSQL advisory lock per Page/customer
  -> page/customer/open-conversation upsert
  -> idempotent inbound message insert
```

`GET /health` is a liveness probe. `GET /ready` checks PostgreSQL and Redis and returns HTTP 503 when either dependency is unavailable.

## Database migrations

Migrations under `packages/db/migrations` are immutable. The migration runner records a SHA-256 checksum in `schema_migrations` and refuses to continue if an applied file changes. Production recovery is forward-fix or database restore; do not edit an applied migration.

## Package boundaries

- `apps/api`: Fastify routes, ingestion service, worker composition
- `packages/meta`: Meta schemas, HMAC verification, normalization, channel adapters
- `packages/db`: schema, migrations, repository contracts and implementations
- `packages/queue`: BullMQ and in-memory queue adapters
- `packages/config`: environment validation
- `packages/observability`: structured/redacted logging

The next milestone is Phase 2: harden ordered concurrent conversation processing and add explicit optimistic-concurrency behavior, without adding AI yet.
