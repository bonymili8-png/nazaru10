# Thoroughline — Product Overview

> Working title: **Thoroughline** (thoroughbred + bloodline). The name is a config value
> (`APP_NAME`) and can be changed without code changes.

## A. Executive Summary

Thoroughline is a Telegram Mini App in which the player runs a virtual horse-racing
operation: acquires and develops horses, manages fatigue/health/form, hires staff,
enters races and tournaments, breeds bloodlines and trades on a marketplace.

Key product bets:

1. **Depth over clicks.** Every meaningful action carries a trade-off (training vs.
   recovery, racing now vs. fatigue, selling vs. breeding).
2. **Believable, server-authoritative racing.** A deterministic, seedable,
   physics-inspired race simulation whose statistical behaviour is validated
   before launch (favourites win ~30–40 %, upsets happen, no dominant strategy).
3. **Ledger-first economy.** Every currency movement is a balanced double-entry
   ledger transaction; sources and sinks are observable from day one.
4. **Telegram-native growth.** Share cards, deep links, referrals, bot
   notifications, Telegram Stars for digital goods.
5. **Compliance by design.** MVP uses only virtual, non-withdrawable rewards.
   No betting, no cash-out, no purchasable soft currency (see §K and
   `02-economy.md` §Regulatory).

North-star metric: **Weekly Active Racing Owners (WARO)** — unique users who
entered at least one race in the last 7 days.

## B. Product Vision

> "I start with a small stable and one promising horse and gradually build my own
> professional racing organization."

Player progression identity: Player → Horse Owner → Stable Owner → Breeder →
Champion → Racing Empire Owner.

The product must feel premium (dark luxury, gold/bronze accents, elegant
typography), fast (<3 s initial load), understandable for beginners and deep for
professionals (advanced stats are opt-in, progressive disclosure).

## C. User Personas

| Persona | Core motivation | MVP needs | Later needs | Monetization fit |
|---|---|---|---|---|
| A. Racing Fan | Watch, follow, predict for fun | Race viewer, leaderboards, favourites | Free-to-play predictions (no stake), collectibles | Cosmetics, pass, spectator premium |
| B. Owner | Build a winning stable | Horses, training, races, rewards | Market, tournaments | Pass, convenience, stable cosmetics |
| C. Trainer / Pro | Optimize performance | Detailed stats, fatigue, form | Training plans, analytics, contracts | Pro subscription, analytics |
| D. Breeder | Genetics, rarity, bloodlines | (Phase 2) | Pedigree, breeding market, genetic reports | Breeding analytics, slots |
| E. Spectator | Low effort entertainment | Replays, share cards | Follow, clubs, community events | Ads (rewarded), cosmetics |
| F. Business Partner | Reach & brand | — | Sponsorship, branded races, clubs | B2B contracts (Stripe, off-Telegram) |

## D. Core Game Loop

```
Acquire → Evaluate → Care/Feed → Train ⇄ Recover → Choose race → (Qualify) →
Enter (strategy, jockey) → Watch live race → Results (credits, reputation, rating) →
Reinvest (training, facilities, staff, horses) → Breed / Buy better → Higher tier
```

Goal horizons:

| Horizon | Examples |
|---|---|
| Short (minutes–hours) | Finish training session, recover fatigue, next race start, daily missions |
| Medium (days–weeks) | Win a maiden, move up a class, upgrade facility, weekly missions, auction |
| Long (season+) | Championship, legendary horse, bloodline, Hall of Fame, top stable |

## E. Complete Feature Map

Legend: **MVP** (Phase 1), **P2**, **P3**, **P4** — see `05-delivery-plan.md`.

| Domain | Features | Phase |
|---|---|---|
| Identity | Telegram initData auth, sessions, profile | MVP |
| Onboarding | Questline ch. 1–5, starter horse, tutorial race | MVP |
| Stable | Stable, capacity, level | MVP |
| Stable facilities | 15 facility types, levels, maintenance | P2 |
| Horses | Entity, visible/hidden attributes, lifecycle, status state machine | MVP |
| Fatigue / Form / Health | Continuous fatigue decay, form, bounded injuries | MVP |
| Training | 10 session types, diminishing returns, injury risk | MVP |
| Nutrition, equipment | Feed plans, gear with durability | P2 |
| Staff / Trainers / Jockeys | Hiring, contracts, synergy | P2 (house jockeys in MVP) |
| Races | Scheduled races, classes, entry, strategy, NPC field fill | MVP |
| Race simulation | Tick-based engine, events, commentary, replay | MVP |
| Tracks / Weather | 10 archetypes, 8 weather types, going | MVP |
| Leaderboards | Horse, owner rankings | MVP |
| Economy | Credits, Gems, Reputation, Prestige, ledger | MVP |
| Payments | Provider abstraction, Telegram Stars, webhooks | MVP (Gems packs) |
| Notifications | Bot messages (race result, training done) | MVP |
| Marketplace | Fixed price, timed auction, offers, lease, breeding rights | P2 |
| Tournaments / Seasons | Tiered circuits, qualification, season points | P2 |
| Breeding / Pedigree | Genetics, compatibility, mutations, bloodlines | P2 |
| Clubs / Syndicates | Guilds, treasury, shared ownership (virtual) | P3 |
| Social | Follow, share cards, activity feed | MVP (share), P3 (feed) |
| Referrals / creators | Referral rewards w/ anti-abuse, creator attribution | P2 / P3 |
| Sponsorship / ads | Sponsor contracts, rewarded ads | P3 |
| Analytics | Event tracking, economy dashboard | MVP (events), P2 (dashboards) |
| Admin / Live ops | RBAC admin, config, audit log | MVP (minimal), P2 |
| Anti-fraud | Rate limits, risk score, trust score | MVP (limits), P2 |
| AI | Commentary (template, event-driven), trainer assistant | MVP (templates), P3 (LLM) |
| B2B | Real-world partnerships, external checkout | P4 |
