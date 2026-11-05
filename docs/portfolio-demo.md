# Recruiter demonstration

This project is a portfolio demonstration using **Banh May Atelier**, a fictional bakery. Do not enter real customer data. A demo deployment is not a high-availability commercial service.

## Three-minute walkthrough

1. **Architecture (20 seconds).** Show the README diagram: Messenger webhook → authenticated API → durable queue → bounded tool-using agent → catalog/checkout → outbound message. PostgreSQL is the source of truth; Redis handles work scheduling.
2. **Product discovery (40 seconds).** Ask in Vietnamese for a birthday cake for six people. Show the catalog lookup in Admin Agent Runs. Verify recommendations and prices against the Products view.
3. **Order flow (60 seconds).** Choose an available variant, add a quantity, then supply fictional recipient information. Read the prepared order summary before explicitly confirming. Show exactly one order in Admin. A replay should not create a second order.
4. **Human control (30 seconds).** Request a person, show the handover and human mode, and send another message. The agent must remain silent. Resume AI through the authenticated Admin control.
5. **Engineering evidence (30 seconds).** Show the current CI run, delivery failure tests, migration history, and release evidence. Explain the ambiguous-delivery tradeoff: avoid automatic duplicate sends and make follow-up visible to staff.

## Before a recruiter call

- Check the public `/ready` endpoint and Admin login.
- Use a dedicated Meta test account/Page permitted by the app's current access mode. Recruiters may not be permitted to message a development-mode app; demonstrate through screen sharing when necessary.
- Keep the host machine awake, Docker running, API healthy, and tunnel service online.
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
