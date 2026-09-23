# Validation Report

Reproduce with `pnpm sim:races <n> <seed>` (exits non-zero if any target fails — wired into CI)
and `pnpm sim:breeding <n> <generations>`.

## Race engine — 100 000 races, 10-runner fields, all tracks/distances/weather

| Metric | Target (GDD §I.4) | Result |
|---|---|---|
| Favourite (condition-adjusted ability) wins | 30–45 % | **35.7 %** |
| Favourite finishes top 3 | 60–80 % | **69.5 %** |
| Spearman(ability, finish) | 0.45–0.80 | **0.535** |
| Weakest horse wins | > 0, < 3 % | **0.8 %** |
| Strategy win share (identical horses) | 8–30 % each | **10.5–23.9 %** |
| Draw bias (best / worst gate) | < 1.6× | **1.34×** |
| Median winning margin (10k run) | < 5 L | **3.2 L** |
| Median winner→last margin (10k run) | < 35 L | **27.6 L** |
| Mean winner speed | believable (15–17 m/s) | 15.5 m/s |
| Determinism (same seed ⇒ identical result) | 100 % | 100 % (unit test) |

Throughput: ~3 ms per 10-runner race including validation overhead, single core.

### What the validation caught (and how it was fixed)
1. **Front-runners dominated (44 %)** with fixed effort levels → pace is now an energy-budgeted
   plan per strategy with fresh-legs conversion of saved energy.
2. **Unrealistic margins (winner by 12 L, last 110 L median)**, found during the live UI
   walkthrough, not by the original targets → added margin targets; traced to (a) jockeys never
   re-planning pace and (b) uncompressed modifier/energy differences. Added mid-race
   re-planning and `performanceSpread` / `energySpread` compression.
3. **AGGRESSIVE dominated (48 %)** once energy was compressed → removed negative reserves,
   firmer exhaustion floor, and tactics now affect post-race wear.

## Genetics — random-mating population, 10 000 foals/generation

| Metric | Target | Result |
|---|---|---|
| Heritability (regression of foal on mid-parent) | ≈ 0.85 | 0.84–0.86 |
| Mutation rate | 1 % ± 0.2 % | 0.84–1.13 % |
| Population mean drift over generations | none | 63.8–64.6 |
| Overall-quality σ | stable, not collapsing | 6.0–8.7 → stable ≈ 6.0 |

## Economy — 300 owners × 28 days (`pnpm sim:economy 300 28`)

See `docs/02-economy.md` §K.4 for the targets, results and the three balance problems the
simulation found (race spam, rich purses, soft-lock) and how they were fixed.
