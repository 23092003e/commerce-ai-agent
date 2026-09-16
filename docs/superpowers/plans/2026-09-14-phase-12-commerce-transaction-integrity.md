# Phase 12 Commerce Transaction Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce cart ownership, make checkout confirmation represent the exact summary shown to the customer, and create exactly one correctly priced confirmed order.

**Architecture:** Agent mutation tools receive trusted conversation scope rather than model-supplied ownership identifiers. Checkout preparation persists an immutable, expiring line-level snapshot; confirmation consumes that snapshot in one locking transaction that revalidates current price, status, inventory, and cart version.

**Tech Stack:** TypeScript, Zod, PostgreSQL transactions/row locks, Drizzle/pg, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-production-completion-design.md`

## Global Constraints

- Preserve migrations through `0013`; create only `0014_checkout_confirmation_lifecycle.sql`.
- Never trust cart/customer/conversation IDs emitted by the model.
- Money is integer minor units and never calculated by the model.
- A stale or expired confirmation creates no order and reserves no inventory.
- A successful confirmation creates one `confirmed` order and resets checkout.

---

### Task 1: Scope every cart mutation to the active conversation

**Files:**

- Modify: `packages/domain/src/cart.ts`
- Modify: `packages/domain/src/agent-tools.ts`
- Modify: `packages/db/src/cart-postgres.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Test: `packages/domain/tests/cart.test.ts`
- Test: `packages/db/tests/cart.integration.test.ts`

**Interfaces:**

- Produces trusted tool inputs:

  ```ts
  type AddCartLineInput = { variantId: string; quantity: number };
  type UpdateCartLineInput = { variantId: string; quantity: number };
  type RemoveCartLineInput = { variantId: string };

  createScopedCartAgentTools(input: {
    cart: CartService;
    customerId: string;
    conversationId: string;
  }): AgentTool[];
  ```

- [ ] **Step 1: Add tests rejecting ownership identifiers from model input**

  Inputs containing `cartId`, `customerId`, or `conversationId` must fail strict
  parsing. Add an integration case where customer A attempts to modify a
  variant through customer B's conversation and verify B's cart is unchanged.

- [ ] **Step 2: Add an inventory regression test for quantity update**

  Add quantity one, then request quantity larger than current available stock;
  expect `inventory_unavailable` and unchanged cart/version.

- [ ] **Step 3: Run focused tests and verify red**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/cart.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/cart.integration.test.ts
  ```

- [ ] **Step 4: Refactor repository operations to trusted scope**

  Replace arbitrary cart-ID updates with SQL that resolves:

  ```sql
  FROM carts c
  JOIN conversations cv ON cv.id = c.conversation_id
  WHERE c.conversation_id = $conversation_id
    AND c.customer_id = $customer_id
    AND c.status = 'active'
  ```

  Lock the active cart, load inventory, validate quantity, mutate, and return the
  versioned cart inside one transaction.

- [ ] **Step 5: Replace `scopedCartTools` with scope-safe tools for all mutations**

  The model supplies only variant and quantity. Trusted scope is always
  overwritten by the handler and never spread from model input.

- [ ] **Step 6: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/cart.test.ts apps/api/tests/agent-message-handler.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/cart.integration.test.ts
  rtk git add packages/domain/src/cart.ts packages/domain/src/agent-tools.ts packages/db/src/cart-postgres.ts apps/api/src/workers/agent-message-handler.ts packages/domain/tests/cart.test.ts packages/db/tests/cart.integration.test.ts
  rtk git commit -m "fix: scope cart mutations to trusted conversation"
  ```

### Task 2: Persist prepared checkout confirmations

**Files:**

- Create: `packages/db/migrations/0014_checkout_confirmation_lifecycle.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/domain/src/checkout.ts`
- Modify: `packages/domain/src/checkout-order.ts`
- Modify: `packages/db/src/checkout-draft-postgres.ts`
- Test: `packages/domain/tests/checkout-order.test.ts`
- Test: `packages/db/tests/checkout-draft.integration.test.ts`

**Interfaces:**

- Produces:

  ```ts
  interface CheckoutConfirmationRepository {
    prepare(
      input: PreparedCheckoutConfirmation
    ): Promise<PreparedCheckoutConfirmation>;
    getPrepared(
      conversationId: string
    ): Promise<PreparedCheckoutConfirmation | null>;
    invalidate(conversationId: string): Promise<void>;
  }

  interface CheckoutOrderConfirmationService {
    prepareConfirmation(
      conversationId: string
    ): Promise<PreparedCheckoutConfirmation>;
    confirmPrepared(input: {
      conversationId: string;
      confirmationId: string;
      confirmationMessageTimestamp: number;
    }): Promise<{ orderId: string; orderNumber: string }>;
  }
  ```

- [ ] **Step 1: Write expiration, immutability, and invalidation tests**

  Use an injected clock. Assert 15-minute expiration, unique confirmation ID,
  immutable line snapshots, and invalidation after cart or checkout-field
  changes.

- [ ] **Step 2: Run tests and verify missing behavior**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/checkout-order.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/checkout-draft.integration.test.ts
  ```

- [ ] **Step 3: Add the forward migration**

  Add `confirmation_prepared_at`, `confirmation_expires_at`,
  `confirmation_consumed_at`, and `confirmation_lines jsonb`. Add checks that
  expiration follows preparation and consumption cannot precede preparation.
  Index active confirmation IDs. Existing rows remain unprepared.

- [ ] **Step 4: Build the snapshot from current server data**

  Preparation locks the active cart and reads current product/variant names,
  variant price, currency, status, and available quantity. It never uses the
  cart's price snapshot as current price. Update cart item price snapshots only
  as part of preparation and let the cart-version trigger advance.

- [ ] **Step 5: Persist and return the exact confirmation summary**

  Calculate the confirmation HMAC over every field, including line snapshots,
  timestamps, cart version, totals, and conversation ID. Store the complete
  snapshot before any customer-facing confirmation request is planned.

- [ ] **Step 6: Invalidate on mutation**

  Cart add/update/remove and checkout field changes clear all confirmation
  columns in the same transaction. A cleared confirmation cannot be restored by
  retry; preparation creates a new ID.

- [ ] **Step 7: Run tests and commit**

  ```powershell
  rtk pnpm.cmd db:migrate
  rtk pnpm.cmd exec vitest run packages/domain/tests/checkout-order.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/checkout-draft.integration.test.ts packages/db/tests/cart.integration.test.ts
  rtk git add packages/db/migrations/0014_checkout_confirmation_lifecycle.sql packages/db/src/schema.ts packages/domain/src/checkout.ts packages/domain/src/checkout-order.ts packages/db/src/checkout-draft-postgres.ts packages/domain/tests/checkout-order.test.ts packages/db/tests/checkout-draft.integration.test.ts
  rtk git commit -m "feat: persist exact checkout confirmations"
  ```

### Task 3: Render and require the prepared confirmation

**Files:**

- Modify: `packages/domain/src/agent-orchestrator.ts`
- Modify: `packages/domain/src/agent-tools.ts`
- Modify: `apps/api/src/workers/agent-message-handler.ts`
- Test: `apps/api/tests/agent-message-handler.test.ts`
- Test: `packages/domain/tests/checkout-flow.test.ts`

**Interfaces:**

- Adds tool `checkout.prepareConfirmation`.
- Confirmation handler accepts only the stored confirmation ID associated with
  the active conversation.

- [ ] **Step 1: Add multi-turn confirmation tests**

  Assert that collecting the last field prepares a summary, the outbound text
  contains exact lines and total from the stored snapshot, ambiguous “ok” asks
  a clarification without ordering, and explicit confirmation consumes the ID
  shown in the preceding outbound message.

- [ ] **Step 2: Add tests for old and early confirmation messages**

  A message timestamp at or before `preparedAt`, a mismatched confirmation ID,
  and an expired confirmation must create no order and return a recoverable
  customer response or handover.

- [ ] **Step 3: Implement deterministic confirmation rendering**

  Render product, variant, quantity, unit price, line total, shipping,
  discounts, total, recipient, redacted phone, address, and payment method from
  `PreparedCheckoutConfirmation`. The model cannot rewrite these values.

- [ ] **Step 4: Replace `isReady/confirm` shortcut**

  Remove creation of a new confirmation snapshot after the customer says yes.
  Confirmation must load and consume the previously persisted ID.

- [ ] **Step 5: Run focused tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run apps/api/tests/agent-message-handler.test.ts packages/domain/tests/checkout-flow.test.ts packages/domain/tests/checkout-order.test.ts
  rtk git add packages/domain/src/agent-orchestrator.ts packages/domain/src/agent-tools.ts apps/api/src/workers/agent-message-handler.ts apps/api/tests/agent-message-handler.test.ts packages/domain/tests/checkout-flow.test.ts
  rtk git commit -m "fix: bind explicit consent to prepared checkout"
  ```

### Task 4: Make order creation a current-truth transaction

**Files:**

- Modify: `packages/domain/src/order.ts`
- Modify: `packages/db/src/order-postgres.ts`
- Test: `packages/domain/tests/order.test.ts`
- Test: `packages/db/tests/order.integration.test.ts`

**Interfaces:**

- `createConfirmed` consumes a stored confirmation record and returns either an
  existing idempotent order or a newly created confirmed order.

- [ ] **Step 1: Add red transaction tests**

  Cover current price change, inactive variant, cart version change, depleted
  stock, expired confirmation, consumed confirmation, concurrent identical
  confirmation, and concurrent orders competing for the last unit.

- [ ] **Step 2: Add lifecycle tests**

  After success assert:

  ```ts
  expect(order.status).toBe('confirmed');
  expect(cart.status).toBe('converted');
  expect(conversation.checkoutState).toBe('none');
  expect(confirmation.consumedAt).not.toBeNull();
  ```

  Then create a new cart and prove a second checkout can start in the same open
  conversation.

- [ ] **Step 3: Run the focused integration suite and verify red**

  ```powershell
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/order.integration.test.ts
  ```

- [ ] **Step 4: Lock and verify current truth in one transaction**

  Use `FOR UPDATE` on checkout draft, cart, cart items, variants, and inventory.
  Compare current variant prices/status and cart version with the stored
  confirmation. Reject mismatches before any insert or reservation.

- [ ] **Step 5: Commit all success state changes atomically**

  Insert status `confirmed`, line snapshots from current verified rows, reserve
  inventory, convert cart, consume confirmation, and reset checkout state in the
  same transaction. The unique confirmation index handles idempotent replay.

- [ ] **Step 6: Return typed recoverable errors**

  Use `confirmation_stale`, `confirmation_expired`,
  `confirmation_consumed`, and `inventory_unavailable`; do not expose SQL or
  internal error text to the customer.

- [ ] **Step 7: Run tests and commit**

  ```powershell
  rtk pnpm.cmd exec vitest run packages/domain/tests/order.test.ts
  rtk pnpm.cmd exec vitest run --config vitest.integration.config.ts packages/db/tests/order.integration.test.ts packages/db/tests/cart.integration.test.ts
  rtk git add packages/domain/src/order.ts packages/db/src/order-postgres.ts packages/domain/tests/order.test.ts packages/db/tests/order.integration.test.ts
  rtk git commit -m "fix: create orders from current confirmed truth"
  ```

### Task 5: Phase 12 acceptance and operational guidance

**Files:**

- Modify: `README.md`
- Modify: `docs/production-readiness.md`
- Create: `docs/runbooks/checkout-recovery.md`

- [ ] **Step 1: Document checkout recovery paths**

  Explain stale price/cart, expiration, inventory loss, idempotent replay, and
  how an operator verifies that no partial order or inventory reservation was
  committed.

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
  rtk git add README.md docs/production-readiness.md docs/runbooks/checkout-recovery.md
  rtk git commit -m "docs: define checkout recovery procedures"
  ```

## Phase 12 Exit Criteria

- Cross-customer cart mutation is impossible through domain and SQL boundaries.
- Add and update reject unavailable quantities without changing cart state.
- Customer confirmation consumes the exact previously displayed snapshot.
- Price/status/cart/inventory changes fail atomically with typed outcomes.
- Concurrent replay creates one order and one inventory reservation.
- New orders have status `confirmed`; checkout resets and a second purchase can
  begin.
- Full phase gate is green.
