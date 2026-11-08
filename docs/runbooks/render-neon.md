# Portfolio deployment on Render and Neon

This setup is for a recruiter-facing portfolio, not uninterrupted service. Render Free sleeps after 15 minutes without inbound traffic and can take about a minute to wake. While it sleeps the in-process worker also stops. Free Key Value can lose its contents on restart; the application periodically recovers persisted pending webhook events from PostgreSQL when it is running. Events not persisted before a failure and ambiguous external sends are not guaranteed to be recovered or repeated. Review provider usage limits and AI charges before use.

## Prerequisites

- A Neon project and a dedicated, empty database. Use its **direct**, TLS-enabled connection string, not the `-pooler` endpoint: the application uses session advisory locks. Keep the connection string private.
- A Render account connected to the GitHub repository and access to the branch containing `render.yaml`.
- A Facebook Page, a Meta app configured for Messenger webhooks, the app secret, a verify token and a Page access token with appropriate permissions. Meta review and test-user restrictions may apply.
- An OpenRouter API key and model, plus an OpenAI-compatible embeddings endpoint, model, API key and 1536-dimensional embeddings. Provider usage may be paid and free availability is not guaranteed.

## Deploy

1. Create the dedicated Neon database; copy its direct connection string into a secure location. Never paste credentials into chat or commit them.
2. In Render create a Blueprint from this repository and choose the release branch. The blueprint provisions a Free web service and a private Free Key Value instance in the same region. Confirm both are Free before creating them.
3. Enter the requested environment variables in the Render dashboard. `APP_BASE_URL` must be the actual HTTPS origin assigned to the service, without a trailing path. The desired service name is `fanpage-sales-agent`; its availability and resulting hostname are not guaranteed. If the final hostname differs, update `APP_BASE_URL` before testing Admin. Enter the direct Neon URL as `DATABASE_URL`; generated admin and metrics secrets remain in Render.
4. The service applies database migrations under a PostgreSQL advisory lock before starting. Inspect deployment logs for errors without disclosing secrets. Confirm `/health` and `/ready` succeed on the assigned HTTPS origin.
5. Seed the fictional bakery catalog only once, against the new dedicated database, using the local seed script with a securely supplied `DATABASE_URL`. Do not rerun it on an active store: it can reset inventory reservations. The Free Render service does not provide a shell.
6. Configure the actual Meta webhook URL and verify token in Meta, subscribe the Page, and test an end-to-end conversation with an authorized test account. Confirm message delivery, checkout safeguards, Admin access, and the database state. Do not claim these checks passed until actually verified.

PostgreSQL remains the durable event source, but free hosting does not provide continuous webhook availability. Review the backup and restore runbook before relying on any stored data.
