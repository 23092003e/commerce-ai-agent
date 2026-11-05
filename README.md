# Facebook Fanpage AI Sales Agent

A TypeScript sales-assistant service for Facebook Pages. It receives Messenger webhooks, persists each event, processes conversations in order, uses grounded catalog and knowledge tools, and replies through either an AI or human-controlled mode.

> Portfolio demonstration using the fictional **Banh May Atelier** bakery. Public deployment is pending verification; local tests do not establish live Meta availability. The application supports the Meta Graph API, OpenRouter/OpenAI-compatible AI, and real embedding providers.

## Architecture

```text
Messenger customer
  -> Facebook Messenger Platform
  -> Cloudflare Tunnel (HTTPS)
  -> Fastify API: HMAC verification -> validation -> webhook_events
  -> Redis / BullMQ: durable, deduplicated event job
  -> Inbound worker: ordered claim -> conversation/message persistence
  -> Bounded agent: catalog, knowledge, cart, and checkout tools
  -> OpenRouter / OpenAI decision provider
  -> Meta Send API -> Messenger customer

PostgreSQL stores pages, customers, conversations, messages, agent_runs,
tool_calls, handovers, products, variants, inventory, and knowledge chunks.
```

| Component         | Responsibility                                               |
| ----------------- | ------------------------------------------------------------ |
| `apps/api`        | Fastify server, webhook ingress, and worker composition      |
| `packages/meta`   | HMAC verification, Messenger schema, fake and Graph adapters |
| `packages/queue`  | BullMQ queues, retries, and ordered processing               |
| `packages/db`     | PostgreSQL schema, migrations, and repositories              |
| `packages/domain` | Agent orchestration, catalog, cart, checkout, and knowledge  |
| `packages/config` | Zod-based environment validation                             |

## Event flow

1. Facebook calls `POST /webhooks/meta`.
2. The API authenticates the raw body with `X-Hub-Signature-256` and `META_APP_SECRET`.
3. The payload is validated, deduplicated in `webhook_events`, and enqueued with a deterministic job ID.
4. The worker processes each Page/customer stream in order and persists inbound messages idempotently.
5. `human` and `paused` modes prevent automatic replies. In `ai` mode, the agent can make up to six tool calls.
6. Prices, stock, policies, and orders may only be stated after the relevant tool returns data.
7. Agent runs, tool calls, handovers, and errors are persisted for traceability.

## Requirements

- Node.js 22 or later
- pnpm 11.7 or later
- Docker Desktop with Linux containers
- A Meta App and Page access token for live Facebook messaging
- An OpenRouter or OpenAI API key for live AI replies

## Run locally (PowerShell)

```powershell
pnpm.cmd install
Copy-Item -LiteralPath .env.example -Destination .env
docker compose up -d postgres redis
pnpm.cmd db:migrate
pnpm.cmd dev
```

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/ready
```

`/health` is a liveness check. `/ready` checks PostgreSQL and Redis, and returns HTTP 503 until both dependencies are ready.

## Configuration

Never commit or share `.env` files, tokens, or API keys.

### Fake mode

```env
META_ADAPTER=fake
AI_PROVIDER=fake
```

### Facebook Graph API

```env
META_ADAPTER=graph
META_APP_SECRET=<meta-app-secret>
META_VERIFY_TOKEN=<random-string-at-least-16-characters>
META_PAGE_ACCESS_TOKEN=<page-access-token>
META_GRAPH_API_VERSION=v23.0
```

The callback must be publicly accessible over HTTPS, for example `https://api.example.com/webhooks/meta`. In Meta Developers, verify the callback, connect the intended Page, and subscribe to the `messages` field.

### OpenRouter

```env
AI_PROVIDER=openrouter
AI_MODEL=deepseek/deepseek-v4-flash
AI_API_KEY=<openrouter-api-key>
```

The provider uses the Responses API with a JSON Schema response format and permits only known tool names. Reasoning is disabled in the sales flow to favour concise, predictable replies.

### Reply pacing

```env
HUMAN_REPLY_DELAY_ENABLED=true
HUMAN_REPLY_DELAY_MIN_MS=800
HUMAN_REPLY_DELAY_MAX_MS=2600
HUMAN_REPLY_TYPING_CHARS_PER_SECOND=20
```

Pacing uses an asynchronous timer, never a busy wait. Set `HUMAN_REPLY_DELAY_ENABLED=false` for immediate local test replies.

## Cloudflare Tunnel

For a continuously running Linux server, use the [VPS deployment runbook](docs/runbooks/vps-deploy.md) and the production Compose + Caddy profile. The proposed domain is `demo.boywithlycoris.online`; no public URL is claimed live until verified. A VPS has not yet been provisioned.

1. Create a managed tunnel in Cloudflare Zero Trust.
2. Create a public hostname, such as `api.example.com`.
3. Route that hostname to `http://localhost:3000`.
4. Install the Cloudflared service so the tunnel starts with Windows.
5. Check `https://api.example.com/ready` before verifying the Meta callback.

The machine that hosts the tunnel, API, Docker, PostgreSQL, and Redis must remain online for the bot to operate.

## Production image and Admin

The non-root multi-stage Docker image runs compiled JavaScript and serves Admin at `/admin/` on the same origin. Production requires real Meta, AI and embedding configuration, an HTTPS `APP_BASE_URL`, and independent Admin/metrics secrets. See `.env.production.example` and [deployment](docs/runbooks/deploy.md).

Admin uses a signed HttpOnly/SameSite session, CSRF tokens, origin checks, expiration, rate limits and logout. The signing secret is never stored in browser localStorage. Legacy bearer access is development-only and must be explicitly enabled. Logout revocation and rate-limit state are process-local for the single-instance demo; multi-replica operation requires shared state, and a process restart clears revocations. Rotate the signing secret to invalidate all existing sessions.

Prometheus output is protected at `/internal/metrics`; use an Admin session or the separate metrics bearer secret. Metric labels use fixed allowlists and exclude customer text/identifiers. Alert routing still requires an external monitoring setup and a controlled notification test.

## Bakery demonstration catalog

**Banh May Atelier** contains 12 products, 24 variants, and five categories: birthday cakes, mousse cakes, artisan bread, pastries, and cookies/gifts.

Each record includes price, serving size, allergens, shelf life, stock, and sales copy. The seed archives the older demo apparel catalog; it does not delete data.

```powershell
pnpm.cmd seed:bakery-demo
```

The script is safe to re-run because it keys records by slug and SKU. Use the catalog only for testing, then replace it with approved store data before going live.

## Sales playbook

- The Vietnamese persona uses `em` for itself and `anh/chị` for customers whose preferred form of address is unknown.
- Discover one need at a time and recommend at most three suitable options.
- Query tools before discussing price, stock, delivery, or policy details.
- Handle objections with empathy, evidence-backed benefits, then a gentle question.
- During checkout, confirm the product before gathering name, phone number, address, and payment details in sequence.
- Hand over only when the customer requests a person or a staff-only action is required.

## Control modes

| Mode     | Behaviour                            |
| -------- | ------------------------------------ |
| `ai`     | The agent may reply automatically.   |
| `human`  | Only staff reply.                    |
| `paused` | Automation is temporarily suspended. |

Control updates use optimistic versioning to prevent staff and the agent from overwriting each other.

## Quality checks

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:integration
pnpm.cmd build
```

Golden sales-agent evaluations are deterministic and run with the normal test
suite. They cover 50 release-risk scenarios across product discovery, policy
knowledge, cart, checkout, inventory, safety, and human handover; no AI or
Meta credential is used.

```powershell
pnpm.cmd --filter @fanpage/domain exec vitest run tests/evals.test.ts tests/golden-scenarios.test.ts
```

To load-test a locally running API with uniquely signed fixture events, use:

```powershell
pnpm.cmd load:webhook -- --count 100 --concurrency 10
```

The script reports a unique run ID, accepted/failed requests, terminal processing/delivery totals and p50/p95/p99 acknowledgment and complete-turn latency. It reads optional `.env.load`, requires the isolated `fanpage_sales_agent_test` database and refuses an API without the non-production fake messaging surface. A remote fake target additionally requires `--allow-remote --run-label <label>`. Stop the load API before running integration tests, which recreate the isolated test schema.

`test:integration` requires healthy Postgres and Redis. Stop the local API before running it so the live worker cannot consume test queue jobs.

```powershell
pnpm.cmd fixture:send
```

The fixture signs the raw payload using the local app secret. Change its Meta message ID to send it again because duplicate IDs are intentionally deduplicated.

## Retrieval provenance and evaluations

Production selects explicit OpenAI-compatible embeddings with validated dimensions, timeouts and vector normalization. Documents are versioned by source, content hash, provider, model and dimensions; queries exclude incompatible provenance. Historical demo documents without retained source require approved source re-import.

The reindex command defaults to no implicit action and requires one mode. Configure destination provider settings through a private environment, then preview before executing:

```powershell
pnpm.cmd knowledge:reindex -- --source-provider deterministic --dry-run
pnpm.cmd knowledge:reindex -- --source-provider deterministic --execute
```

Real-provider evaluation is separate and opt-in; it may spend API credits and is never run by normal CI:

```powershell
pnpm.cmd eval:live-agent -- --live
```

See [recruiter walkthrough and CV wording](docs/portfolio-demo.md) and the [release ledger](docs/releases/2026-11-05-progress.md).

## Database and current limitations

Migrations in `packages/db/migrations` are immutable. The runner records each SHA-256 checksum in `schema_migrations`. Recover production with a forward migration or database restore; never edit an applied migration.

- The Admin UI and fictional catalog are intended for demonstration.
- Durable outbound intents resume definitive retryable rejections using stored text. Ambiguous delivery requires human follow-up; external delivery is not exactly-once.
- Free hosting capacity/availability and AI provider credits are separate from application correctness.
- Demo catalog and FAQ content must be replaced with approved store data before public launch.
- Meta App Review and production permissions depend on the Page owner's Meta account.

## Security

- Do not expose PostgreSQL or Redis publicly.
- Expose only the HTTPS callback endpoint.
- Verify the HMAC before parsing JSON.
- Use least-privilege tokens and monitor `/ready`.
