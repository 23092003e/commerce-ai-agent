# Phase 12 commerce transaction integrity

Status: implementation and focused verification complete; full combined phase gate remains pending.

Implemented:

- Cart tools reject model ownership fields; every database mutation resolves the active cart from trusted customer/conversation scope and checks conversation ownership.
- Add/update lock current product, variant and inventory rows; unavailable quantities roll back without changing cart/version.
- Forward migration `0014_checkout_confirmation_lifecycle.sql` adds prepared/expiry/consumed timestamps and immutable line snapshots, lifetime checks, and active confirmation index. Cart item changes invalidate prepared confirmations in the same transaction.
- Checkout preparation locks server data, refreshes cart price snapshots from current prices, signs every summary field with a unique nonce and a 15-minute expiry, and persists before rendering.
- Consent accepts only the previously stored confirmation ID with an inbound timestamp later than preparation. It does not generate a new snapshot after consent.
- Order transaction locks the conversation, draft, cart, items, products, variants and inventory; rejects changed price/status/cart, unavailable stock, expiry and consumed confirmations before committing business state.
- Success atomically creates one `confirmed` order, reserves inventory once, converts the cart, consumes confirmation, clears checkout fields and resets conversation checkout to `none`. Existing confirmation replay returns the same order.
- Deterministic summary includes exact lines, totals, recipient, masked phone, address and payment method. Runtime handler integration is owned by the delivery task.

Evidence (2026-11-05):

- New domain tests observed red before prepared lifecycle/order guards, then passed.
- Focused domain gate: 5 files / 13 tests passed.
- Focused PostgreSQL gate: 3 files / 14 tests passed (`cart`, `checkout-draft`, `order`). New order suite first failed 8/9 cases against previous implementation, then passed all 9.
- Concurrency coverage includes simultaneous identical confirmation replay and two customers competing for the final stock unit.
- Domain/database package typechecks passed; scoped ESLint passed.
- Integration commands used the existing isolated `fanpage_sales_agent_test` setup in a coordinated exclusive window. No local `.env` was read, no real messages sent, no commit/push/deployment performed.

Pending: final combined lint/typecheck/unit/integration/build gate, parent review, and runtime multi-turn acceptance tests after handler/context integration.
