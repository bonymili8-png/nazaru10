# Security Audit & Performance (MVP checkpoint)

## Security review (task 20.2.1)

| Area | Check | Status |
|---|---|---|
| Authentication | Telegram initData HMAC (constant-time), auth_date window, future-date rejection, duplicate-key rejection; unit-tested with forged/tampered/expired vectors | ✅ |
| Sessions | HS256 JWT with issuer check, 12 h TTL; user status/role re-read on every request (suspension is immediate) | ✅ |
| Dev login | `/auth/dev` 404s unless `ALLOW_DEV_AUTH`; env schema refuses to boot production with it enabled or with placeholder secrets | ✅ |
| Authorization / IDOR | Ownership verified inside the row-locked transaction for every horse/entry mutation; RBAC on admin routes; tests cover cross-user attempts | ✅ |
| Injection | All SQL parameterized; the only interpolated identifiers come from fixed whitelists (leaderboard columns, race filters) | ✅ |
| Input validation | zod schemas for every body/query; `ParseUUIDPipe` on ids; 64 KB body limit | ✅ |
| Currency integrity | Single ledger writer; balanced-transaction trigger; non-negative wallets (app + CHECK); idempotency keys; concurrency tests (50 parallel debits) | ✅ |
| Race integrity | Server-only simulation; commit–reveal seed; results released on the broadcast clock (no spoilers via API); lifecycle steps idempotent | ✅ |
| Payments | Webhook secret header (constant-time); order/user/amount/currency matched; charge-id uniqueness; client callback never credits; refunds audited | ✅ |
| Rate limiting | Token buckets per user/IP; **fixed:** X-Forwarded-For was trusted unconditionally (spoofable IPs bypassed auth limits) → now `TRUST_PROXY_HOPS` (default 0), regression-tested | ✅ fixed |
| Append-only data | Ledger, audit log, ownership history protected by triggers; genome immutable | ✅ |
| Output encoding | React escaping, no `dangerouslySetInnerHTML`; bot messages HTML-escaped (tested) | ✅ |
| Headers | nosniff, no-referrer, frame DENY, no-store on API; CORS allow-list (default deny) | ✅ |
| Secrets | Env only; `.env*` git-ignored; minimum lengths enforced | ✅ |

Open items (not blocking MVP, tracked in `project-state.json`): Redis-backed rate limiting before
running >1 API replica; CSP headers must be configured on the static web host; GDPR export/delete
workflow (P2); risk scoring (P2).

## Performance (task 20.3.1)

Single API process (Node 22, Fastify), local Postgres 16, 200 authenticated users, 50 concurrent
clients, 20 s, mix of `/home`, `/races`, `/horses`, `/leaderboard/horses`, `/wallet`:

| Requests | Throughput | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| 22 920 | ~1 150 req/s | 35 ms | 89 ms | 108 ms | 0 |

Race simulation cost: ~3 ms per 10-runner race (validation harness, single core) — a single
worker can settle thousands of races per minute; workers scale horizontally via
`FOR UPDATE SKIP LOCKED`.
