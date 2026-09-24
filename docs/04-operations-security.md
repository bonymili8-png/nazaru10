# Admin, Anti-Fraud, Security, Analytics

## T. Admin Panel

Roles (RBAC, `users.role` + `admin_permissions` in P2): SUPER_ADMIN, GAME_ADMIN,
ECONOMY_ADMIN, SUPPORT_ADMIN, TOURNAMENT_ADMIN, CONTENT_ADMIN, FINANCE_ADMIN,
FRAUD_ANALYST.

| Capability | Role | Status |
|---|---|---|
| Search users (username, Telegram id, stable, id); inspect wallet, ledger, payments | SUPPORT, FINANCE, ECONOMY, FRAUD | ✅ console |
| Grant/revoke currency (ledger ADMIN_ADJUSTMENT, reason required) | ECONOMY | ✅ console |
| Suspend (SUPPORT, FRAUD) / reinstate (SUPPORT) user | SUPPORT, FRAUD | ✅ console |
| Audit log viewer | SUPPORT, FINANCE, ECONOMY, FRAUD | ✅ console |
| Economy dashboard (supply, mint/burn by reason, daily) | ECONOMY, FINANCE | ✅ console |
| Edit game config: versioned override, validated against defaults, audited, live in ≤ 30 s on every node | edit: ECONOMY; view: ECONOMY, GAME | ✅ console |
| Payments list; refund (Telegram Stars refund + gem clawback, atomic, reason required) | FINANCE | ✅ console |
| Races list (upcoming/live/recent); create special race (distance validated per track); cancel with refunds | GAME, TOURNAMENT | ✅ console |
| Live-ops events, promotions, limited horses | CONTENT, GAME | planned |
| Fraud queue: review flags (dismiss/confirm with audited note); trust scores | FRAUD_ANALYST | ✅ console |

SUPER_ADMIN passes every check. The console (`/admin/`, linked from Profile for non-player
roles) only decides which tabs to show; the API enforces every permission. Config overrides
may only set existing settings with the default's type (`validateConfigOverride`); publishing
`{}` returns to the defaults. Roles are granted in the database (no self-service).

Every admin action writes `audit_logs` (actor, action, target, before/after, reason,
ip) in the same DB transaction as the change. Audit rows are append-only (no UPDATE/DELETE
grants for the app role in production; trigger blocks mutation).

## U. Anti-Fraud & Anti-Cheat

* **Server authority:** results, rewards, balances, stats, ownership and prices are
  computed server-side only; client payloads carry intents (ids + choices).
* **Idempotency:** unique keys for rewards (`race:<id>:prize:<horse>`), payments,
  training settlement, onboarding grants.
* **Rate limiting:** per user & per IP token buckets (auth 10/min, mutations 60/min,
  reads 300/min); in-memory for single node, Redis in P2.
* **Risk score** (P2) = weighted signals: account age, Telegram premium, device/IP
  clustering, referral graph fan-out, impossible action timing, trade graph cycles,
  chargeback/refund history. Actions: throttle → hold rewards → manual review →
  suspend. Never auto-ban on a single signal.
* **Referral abuse:** reward only after the referred user reaches first race + 24 h
  account age; daily cap per referrer; clustered accounts excluded. *Implemented:* the check
  re-runs on each settled race until the invitee is a day old; invitees that signed in from the
  referrer's address never earn it; referrers with trust < 30 get no referrer reward.
* **Implemented signals (every 10 min, idempotent flags, never auto-punish):** sign-in
  address clusters (≥ 3 accounts in 7 days; stored as a keyed HMAC of the IP, never the raw
  address), circular trades (A → B → A within 14 days), trade funnels (≥ 3 sales to one buyer in
  7 days), referral clusters (invitees on the referrer's address), income spikes (> 10× P90 of
  daily income). Trust score = 50 + up to 20 for account age − 5/15/30 per open or confirmed
  flag by severity. Analysts dismiss or confirm in the console (audited); suspension stays a
  separate, audited action.
* **Marketplace:** price sanity bands, self-trade block, circular trade detection.

## V. Security Model

| Threat | Control |
|---|---|
| Forged identity | Telegram initData HMAC validation, auth_date window, constant-time compare |
| Session theft | Short JWT (12 h), HS256 secret ≥ 32 bytes from env, no tokens in URLs |
| IDOR | Every horse/race-entry mutation checks `owner_id = session.userId` inside the tx |
| Injection | Parameterized SQL only (`pg` placeholders); zod validation of all input |
| XSS | React escaping; no `dangerouslySetInnerHTML`; CSP headers on web host |
| CSRF | Bearer tokens (no cookies) → not applicable |
| Replay / double-spend | Idempotency keys + unique constraints + row locks |
| Race conditions | `SELECT … FOR UPDATE` in deterministic lock order; unique partial indexes |
| Currency exploits | Ledger Σ=0 trigger, non-negative user balances, source/sink monitoring |
| Payment fraud | Webhook secret token, payload ↔ payment row match, amount/currency check, charge id unique |
| Privilege escalation | Roles only settable by SUPER_ADMIN via audited action |
| Secrets | Env vars / secret manager; config schema refuses weak/missing secrets in production; dev-auth hard-disabled in production |
| SSRF | No user-controlled outbound URLs |
| Data protection | GDPR: export & delete workflow (P2), minimal PII (Telegram id, names) |

## W. Analytics

Event naming: `snake_case` `object_action` (e.g. `horse_created`, `training_started`,
`training_completed`, `race_entered`, `race_completed`, `payment_completed`).
Domain events are written to the `domain_events` outbox in the same transaction as the
change; an analytics consumer exports them (P2: to ClickHouse/BigQuery).

| Family | KPIs |
|---|---|
| Acquisition | installs (first auth), activation (first race), referral conversion |
| Engagement | sessions/day, races per owner, training actions, market actions |
| Retention | D1/D7/D30, WARO (north star) |
| Monetization | payer conversion, ARPU, ARPPU, LTV, subscription conversion, payment success rate |
| Economy | minted/burned per currency & reason, circulating supply, avg/P90 wallet, inflation |
| Balance | favourite win %, strategy win share, draw bias (live, per week) |

## Observability
Structured JSON logs (pino) with request id; `/health` and `/ready`; metrics
(Prometheus format, P2): request latency, race-run duration, job lag, payment failures,
ledger mint/burn; alerts on economy anomaly, payment failures, race-run errors, job lag.

## Backup / DR
Managed Postgres with PITR (7–30 days), daily logical dump to object storage,
**monthly restore drill** (a backup is only valid after a successful restore test),
migrations always have down scripts, jobs are idempotent and resumable.
