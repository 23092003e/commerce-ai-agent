# Portfolio Deployment and Rollback Runbook

Run from the repository root. A local green build is not proof of a public deployment.

## Production configuration

Copy `.env.production.example` to `.env.production` without overwriting an existing file. Enter secrets directly into the untracked file. Set `RELEASE_TAG` to the full reviewed Git SHA and `APP_BASE_URL` to the confirmed public HTTPS origin. Use random hexadecimal `POSTGRES_PASSWORD` of at least 32 characters so the connection URL is safe. Production rejects fake adapters, deterministic embeddings, missing Admin authentication and placeholder secrets.

Use the standalone production Compose file; do not merge development port bindings into it. Validate without printing resolved credentials:

```powershell
rtk docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
rtk docker compose --env-file .env.production -f docker-compose.production.yml build
```

## Pre-deploy gate

Run the following from the exact commit to deploy:

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd db:migrate
pnpm.cmd test:integration
pnpm.cmd build
```

The integration command requires healthy local Postgres and Redis. CI runs the
same migrations and integration suite with isolated services.

## Deploy sequence

1. Build an immutable container image tagged with the commit SHA.
2. Deploy API and BullMQ worker from that same image without exposing database
   or Redis ports publicly.
3. Run pending forward-only migrations once, with a verified database backup. The production Compose migration service must exit successfully before the API starts.
4. Check `/health` and `/ready`; `/ready` must prove Postgres and Redis access.
5. Verify Meta GET webhook challenge and one signed POST fixture on the new
   revision before sending live Page traffic.
6. Monitor `meta_send_errors_total`, `worker_duration_ms`, and handovers for
   30 minutes.

```powershell
rtk docker compose --env-file .env.production -f docker-compose.production.yml up -d
rtk docker compose --env-file .env.production -f docker-compose.production.yml ps
```

The API includes its queue worker and serves Admin at `/admin/` on the same origin. Only `127.0.0.1:3000` is published for Cloudflare Tunnel. Follow [tunnel verification](cloudflare-tunnel.md) and [backup/restore verification](backup-restore.md).

Verify public readiness, signature rejection, Admin login/logout and CSRF. Use fictional data for product discovery, policy answer, takeover suppression and a prepared checkout with explicit confirmation. Reconcile webhook, agent run, outbound delivery and exactly one confirmed order before recording success.

Retain source SHA, image ID/digest and OCI revision label, migration checksums, gate commands/totals, backup checksum/restore evidence, UTC deployment time, public smoke results and rollback image. Check CI for that same SHA. No provider secret or customer data belongs in the evidence.

## Rollback

1. Stop new traffic to the unhealthy revision and route to the last healthy
   immutable image.
2. Do not roll back an applied migration by editing or deleting it. Use a
   forward migration or restore the verified backup.
3. Leave failed queue jobs intact for investigation; replay only event keys
   confirmed not to have completed customer-visible work.

Keep the previous image before deploying. After reviewing schema compatibility, set `RELEASE_TAG` to its recorded immutable tag and use `up -d --no-build api`; never rebuild an old tag from changed source. For an incident, stop automation and move conversations to human control. Rotate compromised credentials through provider dashboards and the untracked secret file; rotating the Admin signing secret invalidates sessions.
