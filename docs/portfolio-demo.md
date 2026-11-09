# Recruiter demonstration

This project is a portfolio demonstration using **Monexis**, a fictional bakery. Do not enter real customer data. A demo deployment is not a high-availability commercial service.

## Three-minute walkthrough

1. **Architecture.** Show the README diagram and explain signed ingress, PostgreSQL persistence, the queue, catalog tools and operator control. Render's free queue is volatile; the application recovers persisted pending events while its worker is running.
2. **Verified catalog flow.** Ask “Cửa hàng đang bán sản phẩm nào?” and show the three catalog-backed prices. Ask “Butter Croissant giá bao nhiêu, còn hàng không?” and compare both variants with the Admin Products view. These two exact paths have been tested through Messenger.
3. **Human control.** Show the operator console and explain the AI, human and paused modes. Only demonstrate a handover live after verifying it in the current deployment.
4. **RAG and checkout.** A fictional demo document was indexed using 1,536-dimensional embeddings. On November 9, 2026, one Messenger question about delivery returned the relevant document through `knowledge.search` and sent the correct demo policy. Earlier attempts failed or produced irrelevant replies, so this single success does not establish reliability. A complete live order flow remains unverified.
5. **Engineering evidence.** Show relevant local test results and, only when available, the current remote CI run. Explain why an ambiguous Messenger delivery is handed over instead of retried blindly.

## Before a recruiter call

- Check the public `/ready` endpoint and Admin login.
- Use a dedicated Meta test account/Page permitted by the app's current access mode. Recruiters may not be permitted to message a development-mode app; demonstrate through screen sharing when necessary.
- Check Render's current deployment and its Free-plan limits. It can sleep and take time to wake; the worker is not continuous while the service sleeps.
- Confirm demo inventory is available. Never reseed or reset a live database during a call.
- Prepare a 2–3 minute recording showing the same flow in case the host, Meta or AI provider is unavailable.
- Close terminals or dashboards containing credentials and personal messages.

## CV wording

Use only claims whose evidence exists for the submitted revision.

> Built a TypeScript Facebook Messenger sales-agent prototype with Fastify, PostgreSQL/pgvector, Redis/BullMQ and React; implemented authenticated webhook ingestion, bounded catalog/checkout tools, human handover and automated tests.

After the public deployment is verified, replace “prototype” with “deployed portfolio demo” and add the actual URL. Add test totals and latency only from the recorded release evidence; do not reuse older benchmark numbers.

## Interview topics

- Why webhook authentication uses the exact raw body before JSON parsing.
- Why queue deduplication alone cannot guarantee exactly-once external delivery.
- How trusted conversation scope prevents model-supplied IDs from authorizing another customer's cart.
- How an immutable prepared checkout prevents confirmation of a different price or basket.
- How session cookies, CSRF and origin checks protect Admin controls.
- Why deterministic evaluations validate application behavior but cannot establish real model quality by themselves.
- What must change for commercial operation: availability, token lifecycle, real data approval, monitoring ownership, backups and provider permissions.
