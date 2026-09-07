# Facebook Fanpage AI Sales Agent

Production-oriented TypeScript monorepo for a Facebook Messenger commerce agent. It implements secure Meta webhook ingress, durable ordered/idempotent processing, bounded AI sales decisions, catalog and Knowledge RAG tools, checkout collection, and explicit AI/human control state.

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

## Conversational sales behaviour

Inbound replies are paced by message length to feel natural: 0.8–2.6 seconds by default. This uses an asynchronous timer, not a busy wait, and is configurable via `HUMAN_REPLY_DELAY_*` variables. Set `HUMAN_REPLY_DELAY_ENABLED=false` for immediate replies during local testing.

The sales prompt follows a concise consultative playbook: greet and qualify one need at a time, recommend only verified options, handle objections with evidence, and finish with a low-pressure next step. Price, inventory, shipping, policy, and order claims must come from the relevant tool result.

Send the checked-in Messenger fixture through the real local HTTP/queue/worker pipeline:

```powershell
pnpm.cmd fixture:send
```

The fixture sender signs the exact raw JSON bytes with the local app secret. Change its Meta message ID before re-sending if you want a new event; identical IDs are intentionally deduplicated.

In non-production fake-adapter mode, `POST /internal/test/meta/outbound` sends through the fake channel and `GET /internal/test/meta/outbound` returns its in-process captures. These test-only routes are not registered in production or Graph-adapter mode.

## Quality commands

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd build
```

`pnpm test:integration` expects healthy PostgreSQL and Redis services. It verifies the signed webhook pipeline, retry recovery, ordered conversation updates, catalog filtering, live available-to-sell inventory, product-reference concurrency, and grounded knowledge retrieval.

## Runtime flow

```text
Meta webhook
  -> raw-body HMAC verification
  -> Zod payload validation
  -> durable webhook_events insert/dedupe
  -> BullMQ enqueue with deterministic job ID
  -> timestamp-ordered claim per conversation
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
- `packages/domain`: validated provider-neutral catalog contracts and service
- `packages/db`: schema, migrations, repository contracts and implementations
- `packages/queue`: BullMQ and in-memory queue adapters
- `packages/config`: environment validation
- `packages/observability`: structured/redacted logging

The next milestone is Phase 5: add the bounded agent orchestrator that uses the catalog and knowledge tools.
