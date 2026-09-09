# Deployment and Rollback Runbook

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
3. Run pending forward-only migrations once, with a verified database backup.
4. Check `/health` and `/ready`; `/ready` must prove Postgres and Redis access.
5. Verify Meta GET webhook challenge and one signed POST fixture on the new
   revision before sending live Page traffic.
6. Monitor `meta_send_errors_total`, `worker_duration_ms`, and handovers for
   30 minutes.

## Rollback

1. Stop new traffic to the unhealthy revision and route to the last healthy
   immutable image.
2. Do not roll back an applied migration by editing or deleting it. Use a
   forward migration or restore the verified backup.
3. Leave failed queue jobs intact for investigation; replay only event keys
   confirmed not to have completed customer-visible work.
