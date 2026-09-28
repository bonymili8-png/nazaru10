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
| Daily race bonus | 100 credits for the owner's first race of each UTC day, any result |
| Daily allowance (safety net) | 250 credits once per UTC day while below 400, topped up to one entry fee of the owner's cheapest horse |
| Last horse | Cannot be listed or sold on an offer: an owner always keeps one horse |
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

5. **Stress policies** (`SIM_POLICY=reckless|casual pnpm sim:economy`): besides the planning
   owner, the simulation runs an impulsive owner (no reserves: HARD training, staff, elite feed
   and gear bought as soon as the wallet allows) and a casual owner (one session a day, no
   staff). Racing is profitable for ≈ 97 % of owners under every policy (median ≈ +7 000 per
   season). The reckless owner drains to ≈ 400 credits within a week and then climbs back
   (median ≈ 1 100 by day 28) on race prizes plus the allowance (≈ 24 % of their income); no
   owner under any policy spends a day unable to enter a race (gates: no 3-day stuck streak,
   < 3 % stuck owner-days). Two soft-locks found in review are closed: an owner whose horses
   all rate into Class 2/1 (entry 650/1 000 > threshold + allowance) now gets the allowance
   topped up to one entry, and the last horse of a stable cannot be sold.

6. **Daily race bonus** (owner's request: a reason to come back and race every day, and a
   cushion for owners who spent too fast): 100 credits for the first race of each UTC day,
   whatever the result. It adds ≈ 14 % to recurring income, so purses were cut ≈ 15 %
   (Maiden 1 350 … Class 1 14 500) to keep the total level: income moves from winners toward
   everyone who races, and the median wallet stays flat. With owners more solvent, trainer
   adoption rises to ≈ 86–89 %; the gate ceiling is 92 % because the casual policy (never hires
   staff) still wins ≈ 25 % of its races, so staff stays optional. Gate: the bonus is 5–25 % of
   recurring income.

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
| Promotions | Featured market listing (**live**: 30 gems / 24 h, pinned first); featured stable / race later (visibility only) | Gems | none | P3 |
| Spectator | Premium camera, advanced stats, collectible race posters | Gems | none | P3 |
| Sponsorship | Sponsor contracts, branded races (B2B, Stripe/external) | fiat (external) | none | P3–P4 |
| Rewarded ads | Small credits / analytics token, capped daily | — | low | P3 |
| Affiliate | Telegram Mini App affiliate programs; creator referrals | — | — | P3 |

Forbidden: selling race wins, selling stats directly, selling qualification, loot boxes
with competitive horses for real money.

### L.1 Revenue model and payment rails (decided)

- **Players pay only in Telegram Stars** (gem packs, Rookie pack, Owners' Circle). Telegram
  requires Stars for digital goods in Mini Apps; the developer withdraws Stars via Fragment (TON)
  or spends them on Telegram Ads.
- **Gems never buy competitive power.** Anything that changes race results or readiness (feed
  plans, training, staff, facilities) is priced in earn-only credits. Elite feed stays on credits:
  selling it for gems would create a pay → power → prize loop (legal and retention risk).
- **Gem sinks** are cosmetics (silks, crest, cloths), the Racing Pass, information (diagnostics)
  and visibility (featured listings). Further candidates: advanced race analytics, convenience
  (multi-week auto-renew), finish effects.
- **No gems → credits conversion** (owner decision, re-confirmed): not even a capped, bound-credit
  variant. Credits stay earn-only.
- **Finish effects** (live): a stable-wide winner celebration drawn over the race picture for every
  viewer — confetti (free), roses 80, fireworks 100, gold rain 120, lightning 150 gems.
- **Race reports** (live): 10 gems per run (free for Owners' Circle members) — positions at each
  quarter, sectional times against the fastest, energy left, trouble and advice. Computed from a
  finished race's recorded frames only (`raceReport` in the engine); never a prediction.
- **Renames** (live): horse 50 gems, stable 80 gems (sink `RENAMES`). Names are Latin letters,
  digits, spaces and ' & . - only (horse ≤ 24, stable ≤ 30 characters), whitespace collapsed, unique
  case-insensitively among active horses / stables. Default and generated names are unaffected.
- **Live events** are run by the game team within hard limits (purse ≤ ×1.5, XP ≤ ×3, ≤ 7 days) and
  are temporary credit sources to watch on the economy tab; limited horse drops are credit sinks.
- **Expert trainer's advice** (live): 60 gems per horse, information from owner-visible data.
- **Stripe is reserved for B2B**: real-brand sponsorship of named races/tournaments and news-feed
  placements, invoiced outside the game (and physical merch if ever sold). It is never used for
  in-app digital goods. The provider stub stays disabled until the owner connects an account
  (keys only in the hosting settings).

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

### Offers on horses not for sale

Any player can offer for another owner's active horse that is not listed (same price band as the
market, one open offer per horse, up to 10 open offers, a free box needed). The amount is held in
the market escrow; the owner accepts (sale with the usual fee, ownership transfer, every other
open offer on the horse refunded) or declines, the buyer may withdraw, and unanswered offers
expire after 48 h (also when the horse changes hands or retires) with a full refund. Owners are
told by bot message; buyers hear when accepted or declined.

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

* Faucet: one final purse per tournament (Local 7 000 daily … Elite 100 000 fortnightly),
  paid through the normal race prize split; champion prestige/reputation from
  `TOURNAMENT_PRIZE`.
* Sink: entry fees (`TOURNAMENT_FEES`). Refunds go through `TOURNAMENT_REFUND` so the fee sink
  stays honest.
* Simulated (cohort sim, Local daily + Regional every 3 days, owners register their best free
  horse with a 35 % chance when they keep a reserve): ≈ 19 Local entrants a day. With the first
  purse (6 000 < 36 × 200 fees) a Local Cup was a losing bet on average and pulled income toward
  the floor, so the Local purse is 8 000; tournaments now net ≈ 0.7 % of recurring income (gate:
  < 20 %). Since finals became players-only (house horses used to take part of the final purse,
  and could win the final while a player horse was crowned), the whole purse reaches players:
  Local 8 000 → 7 000 and Regional 15 000 → 13 000 keep the tournament share at ≈ 1.8 %
  of recurring income. Regional cups rarely fill in the simulation (it tracks Elo but not season points),
  so higher tiers are validated by the API tests, not the cohort sim.
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

## Cosmetics (live)

* Gems' main sink: racing-silk patterns (Solid free; Hoops 60, Sash 80, Quartered 100, Diamonds
  150, Star 200 gems — config `cosmetics.silkPatternPrices`, admin-tunable). Colours are free.
* Silks show on race cards and live-race markers; they never touch the simulation.
* Stable crest (shown beside the stable name on Home and in owner rankings): shapes and colours
  free; emblems Horseshoe, Star, Crescent free; Crown 60, Lightning 80, Clover 100, Gem 120,
  Laurel 150 gems (config `cosmetics.crestIconPrices`). Item key `crest:<icon>`.
* Saddle cloths (per horse; on its card and as the ring of its race marker): colours free;
  patterns Plain free, Stripe 40, Check 60, Stars 90 gems — unlocked once for the whole stable
  (config `cosmetics.clothPatternPrices`, item key `cloth:<pattern>`).
* Sink `COSMETICS`; unlocks are idempotent per owner and item (`cosmetic:<user>:silk:<pattern>`).

## Racing Pass (live)

* One pass per season (28 days): 20 tiers × 80 XP. XP only from play — 20 per race run, +30/+20/+10
  for 1st/2nd/3rd, 10 per training session — recorded once per source (`pass_xp_events`).
* Free track: 200 gems over the season. Premium track (400 gems, sink `RACING_PASS`): 200 gems back
  plus four pass-exclusive silk patterns (Chevron, Stripes, Cross, Check) that cannot be bought.
* Free-track tiers also pay credits (50 … 300, 1 000 per season), earned only by playing. The
  premium track, bought with gems, never pays credits (that would be a gems-to-credits exchange,
  declined by the owner) — the service drops credits from premium rewards even if configured.
  Modelled in `sim:economy`: ≈ 4.7 % of recurring income, ≈ 35 % of owners reach tier 20 (gate:
  pass credits < 8 % of income).
* Tuning in config `pass.*`; admin overrides can change existing tiers' rewards and prices (new
  tier keys need a release, as the override validator only accepts known settings).

## Sponsors (Phase 3, v1)

Each Monday an owner gets three offers (deterministic per owner and week) from an 8-sponsor
catalog and may sign one contract per week; it runs `contractDays` (7) from signing and pays
600–900 credits + 8–12 reputation (source `SPONSORS`) once its goal is met — e.g. 2 top-3
finishes on turf, 3 starts at 1,800 m+, 1 win, 6 starts. Progress is counted when races settle;
unfinished contracts expire without penalty. Modelled in `sim:economy`: ~54% of contracts
complete and sponsors are ~11% of recurring income (new gate: 2–15%); all 14 gates pass at 300
and 500 owners. Config: `sponsors.offersPerWeek`, `contractDays`, `catalog`.

## Feed plans (Phase 2+, nutrition)

Per-horse weekly feed plans are an optional credit sink (`FEED`) that only speeds recovery
(see game design F.4). The first tuning (Premium ×1.15 / Elite ×1.3 recovery) lifted the player
win rate from 23.6 % to 27.1 % — fresher horses train more and race less tired — so the effects
were cut (×1.08 / ×1.15), prices raised (200 / 500 per week) and house quality nudged up in the
two entry classes (Maiden 0.20–0.44, Class 5 0.34–0.54). Result: win rate 23.0 % (300 owners) /
23.8 % (500), ~58–63 % of owners feed one horse better, feed ≈ 4 % of recurring income. New gates:
10–70 % adoption and feed 1–10 % of income; all 16 gates pass.

## Race-day gear (Phase 2+)

One-off credit purchases (1 000–1 500 per item, sink `EQUIPMENT`). The first tuning had almost no
edge (+0.2 points, a purchase with no visible effect); a stronger one gave +3.6. The shipped values
give +1.6–2.1 points for a well-chosen item, measured against the same race and seed without
gear. The simulated owner buys after the first stable upgrade: ~20–23 % own gear by season end,
gear ≈ 5 % of income, win rate 23.2 % / 23.9 % (300 / 500 owners). New gates: gear edge ≤ 3
points, gear < 10 % of income; all 18 gates pass.

## Owners' Circle subscription (Phase 3)

A Telegram Stars subscription (`OWNERS_CIRCLE`, 150 ⭐ per 30 days, `subscription_period`
2592000). Each paid period (first payment and every automatic renewal, recorded as a child
payment) grants 300 gems; members get three extra colours (platinum, burgundy, teal) for silks,
crest and saddle cloths, a crown badge in rankings and clubs, up to 100 starts of race history
(20 otherwise) and free race reports for every run (10 gems each otherwise). No credits, horses, training or race effects (anti pay-to-win). Members cancel or
resume in-game (`editUserStarSubscription`); benefits last until `period_end`, then a daily job
expires the membership after a 1-day grace for late renewals. Refunding a membership payment
claws back its gems, ends the membership and cancels renewals. `/terms` explains renewal and
cancellation (EN/UK).
