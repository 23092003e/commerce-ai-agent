# Behavioral evaluation evidence

Verified locally on 2026-11-05. No live provider requests were executed.

The deterministic release suite contains **56 literal scenarios**, all passing, with **517 semantic assertions**, **7 cross-turn cases**, and **18 failure-injection cases**. Categories cover product, knowledge, cart, checkout, inventory, safety, and human control.

Every scenario runs the actual orchestrator. Typed catalog/cart/checkout/order domain services use fresh isolated in-memory repositories and realistic tool projections. The evaluator compares validated arguments, allowed/forbidden calls, exact fact references, exact knowledge chunk IDs, final state and forbidden effects. It also checks required rendered content and handover reasons when specified. These tests are deterministic implementation contracts; they are not evidence of a live model's decision quality.

Coverage includes stored position-two product references across turns; add/update/remove across turns; spoofed customer/conversation/cart IDs; stock depletion and oversell rejection; immutable prepared checkout; stale and expired consent; idempotent confirmation replay; invented price/product/order/chunk references; archived or missing policy evidence; and human/paused suppression, including takeover between turns. Mid-turn takeover and provider-delivery races are covered by API tests owned by the delivery workstream, not claimed by this domain suite.

Seven evaluator self-tests deliberately corrupt expected arguments, forbidden calls, final state, fact references, outcome, prepared-confirmation state, and chunk IDs. Each must fail its contract. Release checks require unique scenario IDs, every category, at least 50 cases, at least five cross-turn cases and at least five failure injections.

Commands and results:

- `rtk pnpm.cmd exec vitest run packages/domain/tests/evals.test.ts packages/domain/tests/golden-scenarios.test.ts scripts/evaluate-live-agent.test.ts packages/domain/tests/cart.test.ts packages/domain/tests/checkout-order.test.ts packages/domain/tests/order.test.ts packages/domain/tests/checkout.test.ts packages/domain/tests/checkout-flow.test.ts`: 8 files / 86 tests passed.
- A separate offline `tsx` aggregation of all `runGoldenScenario` results reported `{"scenarios":56,"passed":56,"assertions":517,"crossTurn":7,"failureInjection":18}`.
- Domain and database package typechecks passed. Scoped ESLint passed for the commerce and evaluation files.
- Coordinated isolated PostgreSQL gate for cart, checkout-draft and order: 3 files / 14 tests passed, including concurrent last-stock competition and replay metadata.

## Optional live decision-quality gate

`scripts/evaluate-live-agent.ts` requires explicit `--live` and `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` in the process environment. It defaults to 20 fixed non-mutating scenarios, allows at most three concurrent requests and exits unsuccessfully below a 95% pass rate. The runner exposes only read-only catalog/knowledge tools, never opens a database connection, and reports aggregate token usage when available. Reports contain fixed scenario IDs and bounded failure descriptions, without credentials, customer messages or raw provider responses.

After explicitly approving paid requests and setting credentials in the shell environment, run:

```powershell
rtk pnpm.cmd exec tsx scripts/evaluate-live-agent.ts --live --count 20 --concurrency 3
```

The live command was not run in this session. Its opt-in/configuration guards, concurrency bound, report redaction and token extraction were tested with fake providers/fetch responses only.
