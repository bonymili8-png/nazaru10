# Thoroughline

Telegram Mini App horse-racing management game (working title): build a stable, develop
horses, race them in a server-authoritative simulation and grow a racing empire.

| Path                 | What                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| [`docs/`](./docs)    | Product, game design, economy, architecture, security, delivery plan, validation reports |
| `packages/engine`    | Pure deterministic game logic — RNG, horses, training, race simulation, breeding         |
| `packages/contracts` | Shared API contracts (zod request schemas + response types)                              |
| `apps/api`           | NestJS modular monolith (Fastify, PostgreSQL, plain-SQL migrations, job runner)          |
| `apps/web`           | Next.js Mini App (static export, Tailwind, Telegram WebApp SDK)                          |

## Quick start

```bash
pnpm install
docker compose up -d postgres            # or any Postgres 16
cp apps/api/.env.example apps/api/.env   # adjust DATABASE_URL etc.
pnpm build:packages
pnpm dev:api                             # migrates, serves :3000, runs jobs
cp apps/web/.env.example apps/web/.env.local
pnpm dev:web                             # Mini App on :3001 ("Enter as developer" outside Telegram)
```

## Verify

```bash
pnpm verify            # lint + format + typecheck + all tests (API tests need DATABASE_URL to a test DB)
pnpm sim:races 100000  # statistical validation of the race engine (see docs/06-validation.md)
pnpm sim:breeding      # genetics population simulation
pnpm sim:economy 300 28 # economy cohort simulation (CI gate)
```

Browser end-to-end journeys (Playwright, real API + exported Mini App + Postgres). The API
migrates the database named by `E2E_DATABASE_URL` (default `thoroughline_e2e` on localhost):

```bash
pnpm build && pnpm --filter @thoroughline/e2e build:web
pnpm --filter @thoroughline/e2e exec playwright install chromium   # once
pnpm --filter @thoroughline/e2e e2e
```

## Telegram setup (production)

1. Create a bot with @BotFather, enable a Mini App pointing at the deployed web build.
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WEBAPP_URL`, strong `JWT_SECRET` /
   `RACE_SEED_SECRET`; `ALLOW_DEV_AUTH` must be `false` (the API refuses to start otherwise).
3. `setWebhook` to `https://<api>/telegram/webhook` with `secret_token = TELEGRAM_WEBHOOK_SECRET`
   and `allowed_updates = ["message","pre_checkout_query"]`.
4. Web build env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BOT_USERNAME`, `NEXT_PUBLIC_APP_SHORT_NAME`,
   and **no** `NEXT_PUBLIC_DEV_AUTH`.
5. Hosting the Mini App on Cloudflare Workers (static assets): `wrangler.jsonc` at the repo root
   serves `apps/web/out`. Build command
   `pnpm install --frozen-lockfile && pnpm build:packages && pnpm --filter @thoroughline/web build`,
   deploy command `npx wrangler deploy`, build variables as in step 4 plus `NODE_VERSION=22`.
