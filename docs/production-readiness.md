# Production Readiness Evidence

This checklist maps Phase 10 readiness requirements to evidence. Items marked
**manual** require the Page owner or deployment operator and cannot be asserted
from this repository.

| Requirement                                            | Evidence                                                                                     | Status           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------- |
| Webhook GET verification and POST signature validation | API and Meta webhook tests                                                                   | automated        |
| Webhook dedupe and retry                               | Meta ingestion/pipeline tests                                                                | automated        |
| 24-hour message policy and human takeover              | Agent message handler tests                                                                  | automated        |
| Order confirmation and inventory race protections      | Domain and database tests                                                                    | automated        |
| 50+ golden scenarios                                   | `packages/domain/tests/golden-scenarios.test.ts`                                             | automated        |
| Worker retry and terminal delivery handover            | Agent handler and queue tests                                                                | automated        |
| Metrics redaction                                      | `packages/observability/tests/metrics.test.ts`                                               | automated        |
| Postgres/Redis integration suite                       | Isolated `fanpage_sales_agent_test`; 8 files / 18 tests on 2026-09-09                        | verified locally |
| Signed webhook load harness                            | 100 requests, concurrency 10, 100 succeeded, p50 89.14 ms, p95 129.35 ms on fake API/test DB | verified locally |
| Meta app Live mode and `pages_messaging` review        | Meta developer dashboard                                                                     | manual           |
| Page subscription and production token secret storage  | Meta dashboard and deployment secret store                                                   | manual           |
| HTTPS callback and deployed `/ready` response          | Production smoke test                                                                        | manual           |
| Database backup and restore drill                      | Operator-run restore exercise                                                                | manual           |
| Alert routing                                          | Monitoring platform configuration                                                            | manual           |

Real Page activation is permitted only after every manual item has recorded
operator evidence and the exact deployed revision passes the automated gate.
