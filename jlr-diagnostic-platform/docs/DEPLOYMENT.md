# Deployment

## Topology

```
Telegram ──HTTPS──► reverse proxy (TLS) ──► web (nginx, Mini App) ──/api──► api ──► PostgreSQL
                                                                              │
                                                     private network (VPN / mTLS)
                                                                              ▼
                                                          gateway (next to the vehicle) ──► adapter ──► vehicle
```

In Milestone 1 the API calls the gateway at `GATEWAY_URL`. If the gateway runs on a workshop laptop,
connect it to the API host over a private network (WireGuard, Tailscale, or an mTLS reverse proxy).
Never expose the gateway to the internet. One gateway per API deployment (multi-gateway: Milestone 5).

## Production configuration

Start from `.env.example`:

| Variable | Production value |
| -------- | ---------------- |
| `ENVIRONMENT` | `production` (enables start-up guards) |
| `JWT_SECRET` | 48+ random bytes, e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `GATEWAY_TOKEN` | 32+ random bytes, same value for API and gateway |
| `TELEGRAM_BOT_TOKEN` | from @BotFather (required) |
| `ALLOW_DEV_AUTH` / `VITE_DEV_AUTH` | `false` |
| `DEFAULT_ROLE` | `viewer`; promote technicians deliberately |
| `ADMIN_TELEGRAM_IDS` | your Telegram user ID(s) |
| `POSTGRES_PASSWORD` | strong password; do not publish the port |
| `GATEWAY_INTERFACE` | `socketcan` / `doip` on the vehicle side; `mock` only for demos |
| `GATEWAY_SIM_CONTROL_ENABLED` | `false` |

The API refuses to start in production with dev auth enabled, without a bot token, or with a
development JWT secret.

## Telegram bot

1. Create a bot with @BotFather and copy the token into `TELEGRAM_BOT_TOKEN`.
2. `/newapp` (or Bot Settings → Configure Mini App) and set the Mini App URL to the HTTPS origin that
   serves the `web` container.
3. Open the Mini App from the bot. The Mini App sends `initData`; the API verifies it with the bot
   token and issues a 60-minute access token.

## Steps

```bash
cp .env.example .env && $EDITOR .env
docker compose build
docker compose up -d
docker compose logs -f api            # migrations run on start ("python -m jlr_api all")
```

Put a TLS-terminating proxy (Caddy, Traefik, nginx) in front of `web:80`. Example Caddyfile:

```
diag.example.com {
    reverse_proxy localhost:8080
}
```

Remove the `api` and `postgres` host port mappings in production (`web` already proxies `/api`).

## Operations

* **Migrations**: automatic on API start; manual with `docker compose run --rm api python -m jlr_api migrate`.
* **Backups**: `docker compose exec postgres pg_dump -U jlr jlr_diagnostics > backup.sql`. The audit
  log is append-only at the database level; restoring into a fresh database recreates its triggers
  through the migration.
* **Metrics**: `GET /metrics` on the API (`jlr_api_requests_total`, `jlr_api_request_seconds`) and the
  gateway (`jlr_gateway_operation_seconds`, token-protected). Scrape them on the private network only.
* **Logs**: JSON lines on stdout with `correlation_id`, `operation_id` and `diagnostic_session_id`.
* **Health**: `/api/v1/health` (liveness), `/api/v1/ready` (database + gateway), gateway `/health`.
