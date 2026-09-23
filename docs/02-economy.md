# Economy, Monetization & Marketplace

## K. Economy

### K.1 Currencies

| Code | Name | Type | Purchasable | Tradable | Main sources | Main sinks |
|---|---|---|---|---|---|---|
| `CREDITS` | Credits | soft | **No** (MVP decision) | via market (P2) | race prizes, missions, starter grant, sponsor (P3) | training, entry fees, vet, facilities, staff, market fees |
| `GEMS` | Racing Gems | premium | Yes (Telegram Stars) | No | purchases, pass rewards, rare achievements | cosmetics, analytics reports, convenience, pass |
| `REPUTATION` | Reputation | progression | No | No | placings, missions, fair trading | none (monotonic, seasonal decay 10 %) |
| `PRESTIGE` | Prestige | rare progression | No | No | championships, Hall of Fame | none |

**Why credits are not purchasable in MVP:** paid entry + randomized outcome + prize that
can be converted to value is the legal risk pattern. Keeping Credits earn-only and
non-withdrawable, and Gems unable to buy Credits, keeps competitive rewards
purely virtual and keeps the game from being pay-to-win. Revisit only after legal review.

### K.2 Ledger model (double-entry)

* Every balance lives in an `accounts` row: `(owner_type, owner_id, currency)`.
* User accounts have `CHECK (balance >= 0)`. System accounts (one per
  `source/sink` reason, e.g. `SYSTEM:RACE_PRIZE:CREDITS`) may go negative — their
  balance *is* the cumulative mint/burn per reason, which powers the economy dashboard.
* A `ledger_transactions` row owns ≥ 2 `ledger_entries` whose amounts sum to **0**
  (enforced by a deferred constraint trigger).
* Each transaction carries a unique `idempotency_key`; replays return the original
  transaction instead of double-posting.
* Flow: `validate → lock accounts (ordered by id, FOR UPDATE) → insert tx + entries →
  update balances → emit domain event → audit → COMMIT`.
* Balances are never computed on the client; `balance += x` without a ledger row is
  impossible because only `LedgerService.post()` writes balances.

### K.3 Starting grant & MVP price list (config `economy.*`)

| Item | Amount |
|---|---|
| Starting credits | 5 000 |
| Starter horse | 1 (Common/Uncommon, balanced genome) |
| Stable capacity L1 / L2 / L3 / L4 / L5 | 3 / 5 / 8 / 12 / 20 |
| Stable upgrade cost | 4 000 / 12 000 / 35 000 / 90 000 |
| Training session (NORMAL) | 60–120 credits by type; LIGHT ×0.6, HARD ×1.5 |
| Vet treatment (heal injury faster) | 300 (minor) / 900 (moderate) |
| Race entry | class table in GDD |
| House horse purchase (primary market) | 1 500 – 25 000 by quality |

### K.4 Faucet/sink balance targets

For a median active owner (2 sessions/day, 3 horses):
* Daily credit **income** ≈ 1 200–1 800 (races + missions).
* Daily credit **spend** ≈ 1 000–1 600 (training, entries, vet).
* Net drift ≤ +15 %/day of income → funds progression (upgrades, horses) without
  runaway inflation. Monitored via `economy_daily` view: `Σ sources − Σ sinks`
  per currency per day, average wallet, P50/P90 wallet.
* Alert if 7-day net mint > 25 % of circulating supply, or any single user's
  daily income > 10× P90.

Purse funding: race purses are **minted** by the system (source), entry fees are
**burned** (sink). Purse ≈ 10–15 × entry fee so that the expected value of a race
for an average entrant (≈1/N of purse × placings) is slightly above the entry fee
(≈1.1–1.3×) — racing is worth doing, but training/vet costs keep net drift controlled.
The `sim:economy` script simulates cohorts to validate these targets.

### K.5 Configuration

All prices, purses, fees and multipliers live in the engine config and in the
`game_config` table (admin editable, versioned, audited). No economy constants are
hard-coded outside config.

### Regulatory

* No betting, no stake-based predictions, no cash-out, no conversion of Credits/Gems
  to Stars/TON/fiat.
* Paid Gems cannot buy Credits, race entries or horses with competitive advantage.
* Any future real-money prize, cash-out, or tokenization requires a separate legal
  review per jurisdiction (gambling / prize-competition law).

## L. Monetization Matrix

| Stream | Product | Currency | P2W risk | Phase |
|---|---|---|---|---|
| Premium currency | Gem packs (Stars) | Stars → Gems | none (Gems can't buy power) | MVP |
| Starter packs | Rookie Owner (cosmetic silks, stable theme, 1 analytics report) | Stars | low | MVP |
| Subscription | Bronze / Silver / Gold / Elite: analytics depth, notification controls, extra training queue slot, stable themes | Stars (subscription invoices) | low: convenience only, capped | P2 |
| Season pass | Racing Pass free/premium track: cosmetics, profile items, race effects, decorations | Gems | none | P2 |
| Information economy | Vet diagnostics reveal hidden traits, genetic reports, race probability distribution | Gems or Credits | low (information, not power) | MVP (diagnostics), P2 |
| Cosmetics | Silks, horse coats/markings, tack skins, stable decorations, finish effects | Gems | none | P2 |
| Marketplace fees | 5–10 % sale/auction, 5 % lease/breeding (Credits sink) | Credits | none | P2 |
| Promotions | Featured listing / stable / race (visibility only) | Gems | none | P3 |
| Spectator | Premium camera, advanced stats, collectible race posters | Gems | none | P3 |
| Sponsorship | Sponsor contracts, branded races (B2B, Stripe/external) | fiat (external) | none | P3–P4 |
| Rewarded ads | Small credits / analytics token, capped daily | — | low | P3 |
| Affiliate | Telegram Mini App affiliate programs; creator referrals | — | — | P3 |

Forbidden: selling race wins, selling stats directly, selling qualification, loot boxes
with competitive horses for real money.

## M. Marketplace (Phase 2)

Listing types: FIXED_PRICE, TIMED_AUCTION (24/48/72 h, anti-sniping +5 min),
PRIVATE_OFFER, LEASE (7/30 days/season, lessee races, lessor gets share),
BREEDING_RIGHTS (stud slots).

Auction state machine: `DRAFT → ACTIVE → ENDED → SETTLED` (or `CANCELLED` with no bids).
Bid flow: validate → lock listing row → verify ownership & status → **reserve funds**
(ledger transfer to escrow account) → update highest bid → release previous bidder's
escrow → audit → event. Settlement is idempotent (`idempotency_key = settle:<listingId>`).
Ownership transfer and payment happen in one DB transaction; a horse can never have
two owners (FK + unique current owner column). Price sanity: listing price must be
within [0.2×, 20×] the valuation model; wash-trading detection by trade graph
(same device/IP clusters, circular trades) feeds the risk score.

## Seasons (Phase 2)

* A season lasts one game year (`lifecycle.realDaysPerGameYear`, 28 days) starting from
  `seasons.epoch`. **Set the epoch to the launch date** (admin `game_config` override) so the
  first public season is Season 1.
* Points: top-6 finishes `[10, 6, 4, 3, 2, 1]` × class weight (Maiden 1 … Class 1 ×6),
  credited to the owner at race time; house horses never score.
* Closing (1 h grace after the end): rewards by final owner rank (credits, gems, reputation,
  prestige — all minted from the `SEASON_REWARDS` source), Hall of Fame entries for the
  champion owner and champion horse (append-only).
