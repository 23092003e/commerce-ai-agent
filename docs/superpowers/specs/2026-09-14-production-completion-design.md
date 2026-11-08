# Facebook Fanpage Sales Agent Production Completion Design

**Status:** Approved planning baseline for Antigravity execution
**Date:** 2026-09-14
**Baseline revision:** `148d1b3`
**Primary source:** `FACEBOOK_FANPAGE_AI_SALES_AGENT_BUILD_SPEC.md`
**Execution index:** `docs/superpowers/plans/2026-09-14-production-completion-index.md`

## 1. Destination

Complete the remaining engineering and operational work required for the
Facebook Fanpage sales agent to run safely against a real Page. Completion
means that an inbound message is never silently lost, customer-visible facts
are grounded in approved data, cart and checkout mutations are tenant-safe,
an order can only be created from the exact confirmation shown to the
customer, human takeover is authoritative, and the exact release revision can
be reproduced, deployed, observed, backed up, and rolled back.

This document is the authority for implementation decisions introduced after
Phase 10. The original build specification remains authoritative where this
document does not explicitly refine it.

## 2. Current Baseline

The repository already contains:

- a TypeScript/pnpm monorepo;
- Fastify webhook verification and signature validation;
- PostgreSQL migrations and pgvector knowledge storage;
- BullMQ/Redis webhook jobs;
- structured catalog, inventory, cart, checkout, order, and handover modules;
- an OpenAI-compatible decision provider used with OpenRouter;
- a React Admin Desk;
- unit and isolated PostgreSQL/Redis integration tests;
- deterministic test embeddings and a fictional bakery seed;
- Phase 10 runbooks, metrics logging, golden scenarios, and a signed load
  harness.

The baseline passes lint, typecheck, 94 unit tests, 18 integration tests, and
the production build. Those checks do not cover the failure paths and domain
invariants specified below.

### 2.1 Review finding traceability

| Baseline finding                                                                | Required resolution   |
| ------------------------------------------------------------------------------- | --------------------- |
| Webhook becomes `processed` before agent delivery; retry then skips the turn    | Phase 11 Tasks 2–6    |
| Same-conversation serialization ends before model/tools/send                    | Phase 11 Tasks 2–3    |
| Provider failures can be swallowed without reply or handover                    | Phase 11 Task 5       |
| Outbound replies have no durable record                                         | Phase 11 Tasks 1, 4–5 |
| Cart update/remove accept model-provided cart IDs                               | Phase 12 Task 1       |
| Confirmation is created after the customer says yes                             | Phase 12 Tasks 2–3    |
| Order uses stale cart price snapshots and defaults to `pending`                 | Phase 12 Task 4       |
| Checkout remains awaiting confirmation after order completion                   | Phase 12 Task 4       |
| Runtime sends no history/cart/checkout/reference context                        | Phase 13 Tasks 1, 4–5 |
| Evidence IDs and commerce claims are not enforced                               | Phase 13 Tasks 2–3    |
| Golden suite checks scripted tool names rather than behavior/state              | Phase 13 Tasks 6–7    |
| Admin control endpoints can diverge from handover records                       | Phase 14 Tasks 1–3    |
| Admin bearer secret lives in browser local storage; no CSRF/rate-limit boundary | Phase 14 Tasks 4–6    |
| Production always uses deterministic 8-D embeddings                             | Phase 15 Tasks 1–3    |
| Most declared metrics are never emitted                                         | Phase 15 Tasks 4–5    |
| Load IDs repeat and results measure HTTP acknowledgment only                    | Phase 15 Task 6       |
| No reproducible image, verified restore, or exact-revision deployment evidence  | Phase 16 Tasks 1–8    |

## 3. Non-Negotiable Invariants

### 3.1 Inbound turn lifecycle

1. A webhook event is `processed` only after its agent turn reaches a durable
   terminal outcome: reply sent, reply deliberately suppressed, or handover
   durably opened.
2. Persisting the inbound message does not complete the webhook event.
3. Replaying an event resumes its existing agent turn and outbound intent. It
   must not repeat a cart, checkout, order, or handover mutation.
4. One conversation has at most one active worker mutation flow. The lock spans
   context loading, model/tool execution, outbound planning, delivery, and
   terminal event update.
5. Terminal failure finalization runs exactly once.

### 3.2 Outbound delivery semantics

Every customer-facing reply is first persisted as an outbound message with a
deterministic `outbound_key` derived from the inbound message ID and reply
kind. Delivery uses this state machine:

```text
queued -> sending -> sent -> delivered
                  -> retryable
                  -> unknown
                  -> failed
```

- `rate_limited` is retryable because Meta definitively rejected the request.
- authentication and invalid-request errors are terminal failures.
- network failure, timeout, process death while `sending`, or an ambiguous
  server failure becomes `unknown`; the system does not automatically resend
  because Messenger Send API has no application idempotency key.
- `unknown` and `failed` open an idempotent handover containing the outbound
  message ID and failure code.
- a retry always sends the already-persisted text; it never reruns the model.
- outbound records appear in the Admin conversation timeline.

This deliberately prefers a visible human follow-up over silently sending a
duplicate message.

### 3.3 Conversation serialization and control

- PostgreSQL session advisory locks keyed by provider/page/customer protect the
  full turn.
- Admin control changes acquire the same lock.
- Nested application services receive an opaque lease context from the outer
  worker and reuse it; they must never attempt to reacquire the same advisory
  lock on a second database connection.
- AI control mode is checked once before model execution and again immediately
  before claiming an outbound message for delivery.
- a conversation in `human` or `paused` mode cannot send an automated reply,
  even when its worker began before the control change.

### 3.4 Cart ownership

- Public agent tools never accept an arbitrary `cartId`, `customerId`, or
  `conversationId` from the model.
- Trusted request scope supplies `conversationId` and `customerId`.
- Cart update and removal resolve the active cart using the trusted
  conversation ID inside SQL.
- Every cart mutation verifies that the conversation belongs to the customer.
- Add and quantity update both validate current available inventory.

### 3.5 Checkout consent and order creation

Checkout has two distinct operations:

1. `prepareConfirmation(conversationId)` recalculates server truth, persists an
   immutable confirmation snapshot, and returns the exact summary shown to the
   customer.
2. `confirmPrepared(conversationId, confirmationId)` consumes that stored
   snapshot after an explicit confirmation message.

A prepared confirmation contains:

```ts
interface PreparedCheckoutConfirmation {
  confirmationId: string;
  conversationId: string;
  cartId: string;
  cartVersion: number;
  recipientName: string;
  phone: string;
  address: { line1: string; ward: string; city: string };
  paymentMethod: 'cod' | 'bank_transfer' | 'other';
  currency: string;
  lines: Array<{
    productId: string;
    variantId: string;
    sku: string;
    productName: string;
    variantName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  shippingFee: number;
  discountTotal: number;
  total: number;
  preparedAt: string;
  expiresAt: string;
}
```

Rules:

- confirmation lifetime is 15 minutes;
- any cart or checkout-field mutation invalidates the prepared confirmation;
- the confirmation message timestamp must be later than `preparedAt`;
- the order transaction locks cart, cart items, variants, inventory, and the
  checkout draft;
- current variant status, inventory, currency, and price are re-read;
- a price or cart-version change returns `confirmation_stale`; the system
  prepares and shows a new summary rather than silently accepting it;
- a successful order is inserted with status `confirmed`;
- inventory is reserved exactly once;
- the cart becomes `converted`;
- checkout state resets to `none` and the confirmation becomes consumed;
- `confirmation_id` is unique, so retry returns the original order.

### 3.6 Agent context

Each turn receives bounded structured context:

```ts
interface AgentContext {
  customerMessage: string;
  controlMode: 'ai' | 'human' | 'paused';
  summary?: string;
  recentMessages: Array<{
    direction: 'inbound' | 'outbound';
    senderType: 'customer' | 'ai' | 'human' | 'system';
    text: string;
    createdAt: string;
  }>;
  cart: null | {
    id: string;
    version: number;
    currency: string;
    lines: Array<{ variantId: string; title: string; quantity: number }>;
  };
  checkout: null | {
    version: number;
    state: string;
    missingFields: string[];
    preparedConfirmationId?: string;
  };
  productReferences: Array<{
    position: number;
    productId: string;
    variantId?: string | null;
  }>;
}
```

- recent messages are limited to 12 and 4,000 characters total;
- summaries are limited to 2,000 characters and updated after 12 new messages
  or 24 hours, whichever happens first;
- phone and full address are not placed in general conversation history;
- cart, checkout, order, price, stock, and address remain structured truth;
- product references are saved after catalog recommendations and loaded on the
  next turn so phrases such as “mẫu 2” resolve deterministically.

### 3.7 Grounding and tool authorization

Prompt wording is not a security boundary.

- Tool authorization is enforced by the registry and trusted request scope.
- Every tool call stores a redacted argument projection and bounded result
  summary.
- Knowledge replies must cite chunk IDs returned by the current turn's
  `knowledge.search`; unknown or archived IDs are rejected.
- `insufficient_evidence` cannot produce a policy claim. The only allowed
  outcomes are a narrowing question or handover.
- Price, stock, SKU, variant, totals, and order numbers are rendered from typed
  tool results rather than copied from unconstrained model text.
- The model may provide warm connective language and one next-step question,
  but application code renders transactional facts.

The reply contract becomes:

```ts
type AgentReplyDecision = {
  type: 'reply';
  intro?: string;
  facts: Array<
    | { type: 'catalog_product'; productId: string }
    | { type: 'catalog_variant'; variantId: string }
    | { type: 'inventory'; variantId: string }
    | { type: 'cart'; cartId: string }
    | { type: 'checkout_confirmation'; confirmationId: string }
    | { type: 'order'; orderId: string }
    | { type: 'knowledge'; chunkIds: string[] }
  >;
  nextQuestion?: string;
};
```

`intro` and `nextQuestion` are each limited to 300 characters. Fact IDs must
resolve from the current tool ledger or trusted server state. A reply with an
unresolvable fact becomes `grounding_failed` and hands over.

### 3.8 Handover consistency

One application service owns all control transitions:

```ts
interface ConversationControlService {
  requestHandover(
    input: {
      conversationId: string;
      reasonCode: string;
      reasonText?: string;
      source: 'agent' | 'delivery' | 'admin';
    },
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
  takeOver(
    input: {
      conversationId: string;
      expectedVersion: number;
      adminActor: string;
    },
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
  resolveToAi(
    input: {
      conversationId: string;
      expectedVersion: number;
      adminActor: string;
    },
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
  pause(
    input: {
      conversationId: string;
      expectedVersion: number;
      adminActor: string;
    },
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
}
```

- entering human mode creates or activates exactly one open handover;
- returning to AI resolves every open handover in the same transaction;
- pausing preserves handover state but blocks automated sends;
- conflict, not-found, and invalid-transition results are typed and mapped to
  HTTP 409, 404, and 422;
- every admin mutation writes an audit log with actor, action, target, before,
  after, and timestamp.

### 3.9 Admin security

- The Admin Desk is served from the API's `/admin` path in production to avoid
  an unnecessary cross-origin surface.
- Development may use a configured CORS allowlist; wildcard origins are
  forbidden when credentials are enabled.
- `POST /internal/admin/session` exchanges the admin secret for an 8-hour,
  signed, `HttpOnly`, `Secure` in production, `SameSite=Strict` cookie.
- The raw admin secret is never stored in browser storage.
- Mutations require an `X-CSRF-Token` bound to the session.
- Session creation is limited to 5 attempts per 15 minutes per IP; authenticated
  admin reads are limited to 120 requests/minute and mutations to 30/minute.
- All responses set appropriate security headers.

### 3.10 Production knowledge retrieval

- Deterministic embeddings remain available only for unit/integration tests.
- `NODE_ENV=production` refuses to start with the deterministic provider.
- An OpenAI-compatible embedding adapter uses separately configured
  `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, dimensions, and
  a 10-second timeout.
- Ingestion records provider, model, and dimensions per document version.
- Changing model or dimensions creates a new version/re-index operation; it
  never mixes vectors with incompatible dimensions.
- Policy retrieval logs only document/chunk IDs, scores, and bounded metadata,
  never raw customer PII.

### 3.11 Observability

Use `prom-client` for process-local Prometheus metrics and keep structured JSON
logs for event detail. `/internal/metrics` requires the admin session or a
separate metrics bearer secret.

Required emitted metrics:

- webhook request/event accepted, duplicate, rejected, and failed totals;
- full worker-turn duration p50/p95/p99 through histogram buckets;
- agent and provider latency, error count, and token usage;
- tool duration and errors by allowlisted tool name;
- outbound send results by safe error code;
- handover reasons by bounded reason code;
- RAG evidence/no-evidence totals;
- checkout started, confirmation prepared/stale/expired/consumed totals;
- orders created and idempotently replayed;
- queue waiting, active, delayed, and failed counts;
- process health and dependency readiness.

No customer IDs, message text, phone, address, token, prompt, or raw tool
payload may be a metric label.

### 3.12 Evaluation and load evidence

Deterministic golden evaluations must assert behavior, not merely replay a
preselected answer. Every scenario declares tool fixtures, allowed calls,
expected validated arguments, expected reply fact references, expected state
changes, handover state, and forbidden outcomes.

Release evidence includes:

- at least 50 deterministic scenario cases covering every section in the
  original spec;
- multi-turn tests for product references, cart modification, checkout fields
  across messages, stale confirmation, second order, and human takeover races;
- fault injection at every boundary between inbound persistence, tool mutation,
  outbound planning, Meta send, and terminal event update;
- an optional live-model suite clearly separated from deterministic CI;
- load payload IDs containing a cryptographically random run ID;
- assertions on accepted, processed, replied/handed-over, duplicate, and failed
  counts;
- end-to-end p50/p95/p99 from webhook receipt through terminal agent outcome,
  not HTTP acknowledgment latency alone.

### 3.13 Deployment target

The zero-cost demonstration target is the existing Windows host running Docker
Desktop with Cloudflare Tunnel and a confirmed project hostname. The machine must
remain powered on and connected; this is not a highly available production
platform.

The repository will provide:

- a multi-stage production Dockerfile;
- a production Compose profile for API, PostgreSQL/pgvector, and Redis using
  named volumes and restart policies;
- the Admin Desk served by the API container;
- a migration job that completes before the API starts;
- health/readiness checks;
- secret-only environment injection;
- backup, restore, deploy, smoke-test, rollback, token-rotation, and incident
  runbooks.

No credential, Page token, app secret, OpenRouter key, embedding key, or admin
secret is committed to Git.

## 4. Error Taxonomy

Application services return typed domain errors instead of matching arbitrary
error strings:

```ts
type DomainErrorCode =
  | 'not_found'
  | 'version_conflict'
  | 'invalid_transition'
  | 'ownership_mismatch'
  | 'inventory_unavailable'
  | 'confirmation_missing'
  | 'confirmation_stale'
  | 'confirmation_expired'
  | 'confirmation_consumed'
  | 'grounding_failed'
  | 'delivery_failed'
  | 'delivery_unknown';

class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message);
  }
}
```

HTTP mapping:

| Code                                                              |                 HTTP |
| ----------------------------------------------------------------- | -------------------: |
| `not_found`                                                       |                  404 |
| `version_conflict`, `confirmation_stale`, `confirmation_consumed` |                  409 |
| `invalid_transition`, `ownership_mismatch`                        |                  422 |
| `confirmation_missing`, `confirmation_expired`                    |                  409 |
| unauthenticated/invalid session                                   |                  401 |
| invalid CSRF                                                      |                  403 |
| rate limited                                                      |                  429 |
| unexpected internal failure                                       | 500 with opaque body |

## 5. Migration Policy

- Existing migrations `0001` through `0012` are immutable.
- New schema work starts at `0013`.
- Every migration has an integration test and is safe when applied once to a
  database containing existing demo data.
- Enum changes and backfills are forward-only.
- Destructive column removal is deferred until at least one compatible release
  has run successfully.

Planned migrations:

1. `0013_turn_delivery_reliability.sql`: outbound metadata, delivery states,
   agent-run idempotency, and processing indexes.
2. `0014_checkout_confirmation_lifecycle.sql`: confirmation timestamps,
   consumed state, line snapshot, and invalidation support.
3. `0015_admin_sessions_and_audit.sql`: admin audit records; sessions themselves
   remain stateless signed cookies.
4. `0016_knowledge_embedding_metadata.sql`: provider/model metadata required for
   safe re-indexing.

## 6. Compatibility Strategy

- Add new repository methods before removing old ones.
- Keep the current bearer-token admin authentication behind
  `ADMIN_LEGACY_BEARER_ENABLED=false` for one development-only transition;
  production always rejects the legacy path.
- Read old knowledge documents with their existing dimension metadata, but do
  not serve them in production until re-indexed by the configured provider.
- Existing active checkout drafts without a prepared confirmation are treated
  as `confirmation_missing` and must be prepared again.
- Existing outbound-less agent runs remain visible as historical records; no
  synthetic sent messages are created.

## 7. Definition of Done

Engineering completion requires all of the following on the exact candidate
revision:

```powershell
rtk pnpm.cmd install --frozen-lockfile
rtk pnpm.cmd lint
rtk pnpm.cmd typecheck
rtk pnpm.cmd test
rtk pnpm.cmd db:migrate
rtk pnpm.cmd test:integration
rtk pnpm.cmd build
rtk git diff --check
```

Additionally:

- every acceptance test in the six execution plans passes;
- fault-injection tests prove no lost reply and no duplicate mutation;
- the load harness reports exact database terminal counts;
- no tracked file contains a secret;
- the production image runs as a non-root user;
- backup and restore are demonstrated against a disposable database;
- the public callback validates and `/ready` returns ready through Cloudflare;
- a real Page test proves inbound message, grounded reply, handover, and order
  confirmation using non-sensitive test data;
- the exact deployed Git SHA is recorded in release evidence.

## 8. Human-Required Gates

Antigravity performs all repository work autonomously. It stops only when one
of these external actions is actually required:

1. entering or rotating a Meta/OpenRouter/embedding/admin secret in the local
   secret store;
2. approving Meta permissions or switching the Meta app to Live mode;
3. confirming the final Cloudflare hostname/routes;
4. choosing a backup destination outside the workstation;
5. sending the final real-Page smoke-test messages;
6. authorizing Git push or deployment if that authorization has not already
   been given for the current batch.

When stopping, Antigravity must ask for exactly one concrete action, include a
copy-paste instruction, and continue automatically after the user confirms.

## 9. Out of Scope

- online card charging, refunds, or payment-provider reconciliation;
- automatic shipment creation;
- generative image handling or OCR;
- voice calls, comments, Instagram, WhatsApp, or additional social channels;
- promotion rule authoring beyond reading approved structured data;
- multi-region high availability;
- replacing the fictional demo catalog with a real merchant catalog without
  explicit merchant approval.

## 10. Execution Order

The plans must be completed in this order:

1. Phase 11 — turn and delivery reliability.
2. Phase 12 — cart, checkout, and order integrity.
3. Phase 13 — context, grounding, and real evaluations.
4. Phase 14 — handover consistency and Admin security.
5. Phase 15 — production RAG, metrics, and load evidence.
6. Phase 16 — release engineering and zero-cost demo deployment.

No later phase may weaken an invariant or replace a typed boundary introduced
by an earlier phase.
