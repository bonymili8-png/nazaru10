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
| Stable upgrade cost | 3 000 / 12 000 / 35 000 / 90 000 |
| Training session (NORMAL) | 60–120 credits by type; LIGHT ×0.6, HARD ×1.5 |
| Vet treatment (heal injury faster) | 300 (minor) / 900 (moderate) |
| Race entry / purse | class table in GDD (purse ≈ 16× entry fee) |
| Daily allowance (safety net) | 250 credits once per UTC day while below 400 |
| House horse purchase (primary market) | 1 500 – 25 000 by quality |

### K.4 Faucet/sink balance targets (validated by `pnpm sim:economy`)

The first targets (income 1 200–1 800/day) were pre-simulation guesses. The cohort simulation
(`packages/engine/scripts/sim-economy.ts`: 300 owners × 28 days with a planning owner policy,
real training/race/aftermath rules, house fields per class, purchases, upgrades, quests)
showed they did not match the price scale and exposed three problems, now fixed:

1. **Race spam** — horses recovered from a race in ~7 h, so every horse raced twice a day and
   nobody trained. Fatigue recovery is now 1.6/h, post-race fatigue 30 + 8/km, and entries
   require ≤ 50 projected fatigue: a horse races about every other day and training competes
   with racing for the same fatigue budget.
2. **Purses too rich** (average entrant EV ≈ 1.9× the fee → inflation): purses are now ≈ 12×
   the entry fee.
3. **Soft-lock** (28 % of owners ended below the cheapest entry fee): house maidens are now
   young horses (class age bands) and a small daily allowance exists for nearly-broke owners.

4. **Class ladder mismatch** (found when staff and facilities were added): the simulation
   promoted horses by number of wins, the game promotes by Elo rating bands. With the real rule
   the player in-class win rate was ≈ 29 % (Class 4: 52 %): trained player horses sat in easy
   classes against untrained house fields. The simulation now tracks Elo and uses the API's
   eligibility; house quality was raised per class (C5 0.32–0.52 … C1 0.76–0.95) and purses
   raised ≈ 25 % to keep income in range. Result: ≈ 23 % overall (Class 4 ≈ 36 % — only
   the strongest horses get there).

Current targets and results (seeded, deterministic; CI gate):

| Target | Result |
|---|---|
| Recurring income 400–1 200 per owner-day | ≈ 450–470 |
| No inflation: median wallet grows ≤ 25 % over the last two weeks | 3 816 → 3 246 |
| No runaway top: p90 grows ≤ 50 % over the last two weeks | 5 480 → 5 513 |
| < 5 % of owners below the cheapest entry fee at season end | 0 % |
| Average string ≥ 2 horses by season end | 2.49 |
| ≥ 15 % of owners upgrade their stable in a season (conservative simulated owner) | 25 % |
| In-class player win rate 10–25 % (Elo-based eligibility as in the game) | 23.6 % (300) / 24.5 % (500) |
| Allowance < 10 % of income | 0.8 % |
| 20–85 % of owners employ a trainer at season end (eager simulated owner) | ≈ 77 % |
| 10–85 % of owners retain a jockey at season end | ≈ 72 % |
| Staff salaries (trainers + jockeys) 3–25 % of recurring income | ≈ 15 % |
| 5–40 % of owners build a facility within a season | ≈ 16–18 % |

Retained jockeys (added later) lifted the win rate back to ≈ 24 %; house jockey skill bands were
raised (Maiden 35–60 … Class 1 72–94) and purses +5 % (1 600 … 17 100). The win rate varies by
≈ ±1 point between cohort sizes, so the 25 % cap is the binding constraint for any new player
edge: re-tune house fields in the same change.

Operational alerts (economy dashboard): 7-day net mint > 25 % of circulating supply, or any
single user's daily income > 10× P90.

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

## Tournaments (Phase 2)

* Faucet: one final purse per tournament (Local 6 000 daily … Elite 100 000 fortnightly),
  paid through the normal race prize split; champion prestige/reputation from
  `TOURNAMENT_PRIZE`.
* Sink: entry fees (`TOURNAMENT_FEES`). A full Local Cup (36 × 200 = 7 200) burns more than
  it mints; a thin one mints — acceptable at this scale and visible on the economy dashboard
  per source/sink. Refunds go through `TOURNAMENT_REFUND` so the fee sink stays honest.
* Heats pay no purse: a tournament horse spends one committed day for a chance at a purse
  worth ≈ 30× the entry fee, which keeps tournaments aspirational without inflating income.

## Staff (Phase 2)

* Sink: weekly trainer salaries (`STAFF_SALARY`), ≈ 8 % of recurring income in the cohort
  simulation. The simulated owner hires the best of three candidates it can carry for a month
  (keeping 2 500 in reserve and saving first for a stable upgrade when full) and lets the
  trainer go when a week can't be paid comfortably.
* Tuning notes: the first pass (+0.3 %/skill, +8 % speciality) pushed the player in-class win
  rate to the 25 % cap, so the effect was reduced to +0.25 %/skill and +5 % speciality. After
  the class-ladder fix (K.4 item 4) the margins are comfortable again; re-run
  `pnpm sim:economy` after any staff, training or house-field change.
