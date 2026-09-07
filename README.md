# Facebook Fanpage AI Sales Agent

A TypeScript sales-assistant service for Facebook Pages. It receives Messenger webhooks, persists each event, processes conversations in order, uses grounded catalog and knowledge tools, and replies through either an AI or human-controlled mode.

> The project is running end-to-end with the Meta Graph API, Cloudflare Tunnel, and OpenRouter. The **Banh May Atelier** catalog is fictional demonstration data, not real business data.

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

1. Create a managed tunnel in Cloudflare Zero Trust.
2. Create a public hostname, such as `api.example.com`.
3. Route that hostname to `http://localhost:3000`.
4. Install the Cloudflared service so the tunnel starts with Windows.
5. Check `https://api.example.com/ready` before verifying the Meta callback.

The machine that hosts the tunnel, API, Docker, PostgreSQL, and Redis must remain online for the bot to operate.

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

`test:integration` requires healthy Postgres and Redis. Stop the local API before running it so the live worker cannot consume test queue jobs.

```powershell
pnpm.cmd fixture:send
```

The fixture signs the raw payload using the local app secret. Change its Meta message ID to send it again because duplicate IDs are intentionally deduplicated.

## Database and current limitations

Migrations in `packages/db/migrations` are immutable. The runner records each SHA-256 checksum in `schema_migrations`. Recover production with a forward migration or database restore; never edit an applied migration.

- The admin UI is still demonstrative.
- Dedicated outbound-delivery persistence and retry handling are not complete.
- Demo catalog and FAQ content must be replaced with approved store data before public launch.
- Meta App Review and production permissions depend on the Page owner's Meta account.

## Security

- Do not expose PostgreSQL or Redis publicly.
- Expose only the HTTPS callback endpoint.
- Verify the HMAC before parsing JSON.
- Use least-privilege tokens and monitor `/ready`.
