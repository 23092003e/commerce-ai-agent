# Cloudflare Tunnel for the demonstration

The default target is the current Windows machine. The machine, Docker and the tunnel must stay online; this is a portfolio demonstration, not high availability.

1. Confirm the public hostname with the owner. Do not invent a deployment URL.
2. Configure a managed tunnel hostname to `http://127.0.0.1:3000`. A tunnel service uses outbound connections; PostgreSQL and Redis must remain private.
3. Run the application using the production Compose file. `/admin/` and the API share the hostname. Set `APP_BASE_URL` to that exact HTTPS origin; Admin mutations use same-origin session cookies and CSRF protection.
4. Verify locally: `http://127.0.0.1:3000/health`, `/ready`, `/admin/`; unauthenticated `/internal/admin/conversations` must return 401.
5. Verify publicly: certificate and HTTPS, `/health`, `/ready`, Admin login/logout, invalid-signature rejection, and the Meta verification challenge. Do not put the verification token in screenshots or command history.
6. Confirm the Windows Cloudflared service is installed, running and configured for the intended tunnel. Inspect service status, not the config file containing credentials.
7. Only after these checks, set the Meta callback to `https://<confirmed-hostname>/webhooks/meta` and subscribe the intended Page to `messages`.

Do not protect the webhook with a browser login, CAPTCHA or interactive Cloudflare challenge. Admin API authentication is enforced by the application. Additional access controls for Admin may be layered separately if they do not block Messenger callbacks.

If `/ready` fails, repair the dependency before changing the tunnel. If local checks pass and public checks fail, investigate tunnel service, hostname routing and HTTPS configuration.
