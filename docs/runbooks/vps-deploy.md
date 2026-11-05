# Linux VPS deployment

Target: a continuously running Linux VPS. Proposed hostname: `demo.boywithlycoris.online`; confirm it before DNS changes. The VPS identity and access must be supplied before any server operation.

## Host requirements

Use a supported Linux distribution with Docker Engine and Docker Compose v2. A small demonstration should start with at least 2 vCPU and 4 GiB RAM so image builds, PostgreSQL, Redis and the API have working headroom. Actual sizing must be checked under load. Do not purchase a server or change billing without owner instruction.

Allow inbound SSH from the operator's permitted IPs and HTTP/HTTPS on TCP80/TCP443; UDP443 is optional for HTTP/3. Do not publish Postgres5432, Redis6379 or API3000 externally. Preserve existing SSH access and inspect firewall state before applying rules.

## DNS and HTTPS

Point the confirmed hostname's A record to the VPS IPv4 address. Add AAAA only if IPv6 is configured and reachable. If using Cloudflare DNS, initially use DNS-only to diagnose certificate issuance, then decide whether proxying is needed. Caddy obtains and renews the HTTPS certificate and reverse-proxies to the private `api:3000` service.

This VPS profile does not require a Cloudflare Tunnel or the Windows machine to stay online. Do not change DNS until the intended server and hostname are confirmed.

## Prepare the exact revision

Clone the approved repository into a dedicated directory such as `/opt/fanpage-sales-agent`. Check out the exact candidate SHA after its CI passes. Copy `.env.production.example` to `.env.production` only when absent, set mode600 and fill secrets through a private SSH session. Do not send credentials through chat or put them in command-line arguments.

Set `RELEASE_TAG` to the candidate SHA, `PUBLIC_HOSTNAME` to the confirmed hostname and `APP_BASE_URL=https://<that-hostname>`. Real Meta/AI/embedding credentials and strong independent Admin/metrics secrets are required. Use URL-safe random hexadecimal for the database password. Existing8-dimensional demo knowledge must be reindexed before claiming real semantic retrieval with a different embedding model.

```sh
docker compose --env-file .env.production -f docker-compose.production.yml -f docker-compose.vps.yml config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml -f docker-compose.vps.yml build
docker compose --env-file .env.production -f docker-compose.production.yml -f docker-compose.vps.yml up -d
docker compose --env-file .env.production -f docker-compose.production.yml -f docker-compose.vps.yml ps
```

Build on the VPS only if it has enough memory. A registry-based image deployment is a separate configuration choice; never push an image or repository without authorization.

## Verify before sharing

Check loopback health/readiness first. Then verify HTTPS `/health`, `/ready`, `/admin/`, unauthorized Admin401, metrics401, invalid webhook signature401, Admin login/logout and CSRF rejection. Record the exact SHA and image ID/revision label. Do not paste secrets into `curl` command history; use protected input files or a private environment for authenticated checks.

Configure the Meta webhook callback at `https://<hostname>/webhooks/meta`, verify the challenge and subscribe the dedicated Page to messages. App access mode and permissions determine who can message the app; a live hostname alone does not grant recruiter access.

Run the fictional bakery demo and reconcile one order, handover suppression and delivery state. Follow [portfolio walkthrough](../portfolio-demo.md). Share the URL only after these checks pass.

## Backups, updates and recovery

Keep database dumps encrypted outside the VPS. Take a verified backup before migrations and retain the preceding image. Use the Linux backup/restore scripts; restore drills create a separate database. Never run `docker compose down -v` on this deployment. A VPS disk snapshot alone is not tested database recovery.

For an application rollback, point `RELEASE_TAG` to the previously retained compatible image tag and start the API with `--no-build`. Applied migrations are immutable; review compatibility and use forward repairs or a verified restoration procedure.
