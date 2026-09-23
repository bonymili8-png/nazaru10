# Game Design Document

All numeric values below are **defaults** living in `packages/engine/src/config`
(and overridable from the `game_config` table by admins). Code is the source of truth;
this document explains intent. Scale conventions: attributes are `0–100` floats,
fatigue `0–100` (0 = fresh), health `0–100`, form `-1…+1`.

## F. Horse System

### F.1 Entity

A horse = identity + genome (immutable) + current attributes (mutable, bounded by
genome ceilings) + condition (fatigue, health, form, morale) + career record.

| Group | Fields | Visibility |
|---|---|---|
| Identity | id, name, sex (COLT/FILLY/STALLION/MARE/GELDING), birth time, breed, coat, rarity, sire/dam, generation, bloodline | public |
| Trainable attributes | speed, acceleration, stamina, endurance, strength, agility, start, cornering, finalKick, focus | public (current) |
| Innate traits | temperament, courage, consistency, drive, stressResistance | public (revealed gradually), fixed |
| Aptitudes | turf/dirt/synthetic affinity, wetAffinity, optimalDistance, distanceRange | revealed via races/scouting |
| Hidden genome | per-attribute **ceiling** (potential), injurySusceptibility, maturity (peak age), raceIntelligence, adaptability | hidden; revealed by diagnostics/analytics (monetizable information) |
| Condition | fatigue (+ updatedAt), health, injury, form, morale | public |
| Record | starts, wins, places, shows, earnings, raceRating, win splits by track/distance/surface | public |

**Ability rating** (the "Rating" badge) is a weighted sum of current attributes adjusted
for aptitudes; **raceRating** is a competitive Elo-style mark updated only by results.
Rarity is *not* a stat multiplier: it affects cosmetics, trait slots and the width of the
genome ceiling distribution, never the current attributes directly.

### F.2 Status state machine

```
IDLE ──train──▶ TRAINING ──complete──▶ IDLE
IDLE ──enter race──▶ ENTERED ──race start──▶ RACING ──finish──▶ IDLE
ENTERED ──withdraw (before lock)──▶ IDLE
any active ──injury──▶ INJURED ──heal time──▶ IDLE
IDLE ──list on market──▶ LISTED ──sold/cancel──▶ IDLE      (P2)
IDLE/INJURED ──retire──▶ RETIRED ──(mare/stallion)──▶ BREEDING (P2)
```
Illegal transitions are rejected in `HorseStateMachine` and by DB checks.

### F.3 Lifecycle (age)

1 game year = `lifecycle.realDaysPerGameYear` (default 28 real days = one season).

| Stage | Age | Training response | Race eligibility |
|---|---|---|---|
| Foal | 0–1 | none | no |
| Yearling | 1–2 | 1.25× (light only) | no |
| Juvenile | 2–3 | 1.20× | yes (juvenile races) |
| Prime | 3–5 | 1.00× | yes |
| Veteran | 6–8 | 0.50× | yes |
| Retired | ≥9 (forced ≥10) | — | no, breeding only |

Hidden `maturity` shifts the peak ±1 year (early vs late developer). Death is not a
mechanic.

### F.4 Condition

* **Fatigue** decays linearly: `fatigue(t) = max(0, f₀ − rate·hours)`, where
  `rate = 4/h × (0.7 + endurance/250) × facilityBonus`. Stored as value + timestamp and
  evaluated lazily — no cron needed.
* **Performance impact:** `1 − 0.25·(fatigue/100)^1.5` on top speed and energy.
* **Health** regenerates `+2/h`; injuries have a `healsAt` timestamp. Health < 60
  blocks racing.
* **Form** is an exponentially-weighted performance-vs-expectation signal decaying toward
  0 by 5 %/day; ±1 form ≈ ±2 % top speed.

## G. Breeding System (Phase 2, genetics engine ready in MVP)

```
foal.ceiling[a] = clamp( 0.85·mid(sire,dam)[a] + 0.15·POP_MEAN
                         + N(0, σ=6) + mutation[a] − inbreedingPenalty )
```
* **Mutation:** p = 1 % per foal, +8…+18 on one random attribute (rare "gifts").
* **Inbreeding:** Wright-style coefficient over 4 generations; each 1 % raises
  injurySusceptibility and lowers ceilings by 0.5.
* **Aptitudes:** mid-parent + noise; optimalDistance is mid-parent ± N(0, 120 m).
* **Traits** (temperament, courage…): mid-parent ± N(0, 8).
* **Bloodline:** inherited from sire; bloodline reputation = sum of descendants'
  graded wins (P2).
* Controlled randomness: the foal genome is drawn from a seed derived from
  `(breedingEventId, serverSecret)`, stored, reproducible.
* Noise has a shared "overall quality" component (σ 4.5) plus a per-attribute one (σ 4.5),
  so elite outliers stay possible and overall-quality variance does not collapse.
* Validation: simulated breedings — heritability ≈ configured 0.85 (regression slope),
  mutation frequency 1 % ± 0.1 %, stable population mean/σ across generations.

## H. Training System

Session types (`training.types`): SPEED, ACCELERATION, STAMINA, STRENGTH,
AGILITY, STARTS, FINISHING, MENTAL, TACTICAL, RECOVERY. Each has attribute weights,
base fatigue, base cost, duration.

Intensity: LIGHT (×0.6 gain, ×0.5 fatigue), NORMAL (×1), HARD (×1.4 gain, ×1.7 fatigue).

```
gain[a] = baseGain · weight[a] · intensity · ageMult · trainerMult · facilityMult
        · headroom · fatigueEff · repeatDecay · U(0.85, 1.15)
headroom     = (1 − current/ceiling)^0.8      → diminishing returns, 0 at ceiling
fatigueEff   = 1 − 0.7·(fatigue/100)^1.3
repeatDecay  = 0.8^(sessions in last 24h)
fatigue     += baseFatigue · intensityFatigue · (1 − endurance/400)
injuryP      = min(5 %, 0.2 % · intensity² · (1 + 4·(fatigue/100)²) · susceptibility)
```
Anti-spam: training needs status IDLE, fatigue < 85 and health ≥ 60. Injuries from
training are only MINOR (12 h) or MODERATE (48 h); every injury record stores the
risk factors that produced it (explainable, logged, bounded).

### H.1 Staff — trainers (Phase 2)

* A shared pool (kept at 12 free trainers) of trainers with skill 40–95 (most are journeymen,
  ~12 % are 85+) and an optional speciality (any training type except Recovery).
* Effect on every session in the stable, from the employed trainer who helps most for that
  session type: gains × (1 + 0.25 % per skill point above 40, + 5 % in the speciality),
  injury chance × (1 − 0.5 % per skill point above 40). A master (95) specialist gives
  +18.75 % gains and −27.5 % injury risk. The trainer is snapshotted when the session starts.
* A trainer works for one stable at a time. Stable level caps the team: 1 / 1 / 2 / 2 / 3.
* Salary = 100 + 0.35 × (skill − 40)², rounded to 10 (skill 60 → 240, 80 → 660,
  95 → 1 160 per week), charged a week in advance. If a renewal can't be paid the trainer
  leaves (bot notification); dismissal is immediate and the current week isn't refunded.
  After a long outage renewal restarts from now instead of back-charging.

### H.2 Stable facilities (Phase 2)

| Facility | Effect per level | Level costs (1 / 2 / 3) | Level k needs stable level |
|---|---|---|---|
| Training track | +4 % training gains | 4 000 / 12 000 / 30 000 | k + 1 |
| Vet clinic | −10 % training injury chance | 3 000 / 9 000 / 24 000 | k + 1 |

One-off purchases (sink `FACILITIES`), stacking multiplicatively with the trainer; the
effect is snapshotted when a session starts. Facilities only touch training so condition
projection (fatigue/health) stays a pure function of the horse.

## I. Race Simulation

Engine: `packages/engine/src/race`. Pure, deterministic given `(entrants, conditions,
seed)`. Tick-based (Δt = 0.5 s), physics-inspired.

### I.1 Pre-race effective profile per horse
```
topSpeed  = (15.2 + speed·0.04) m/s × fatigueMod × healthMod × formMod × surfaceMod
            × goingMod × weightMod × dayForm      (deviations compressed, §I.2b)
accel     = 1.6 + acceleration·0.03 m/s²
energy    = E₀ · (0.7 + stamina·0.006) · fatigueMod · distanceFit
drainEff  = 1.25 − endurance·0.005
dayForm   ~ N(1, σ),  σ = 0.008 + 0.014·(1 − consistency/100)
```
* **surfaceMod** = 0.97 + 0.06·affinity/100 (±3 %).
* **goingMod** (soft/heavy/muddy) = 1 − penalty·(1 − wetAffinity/100).
* **distanceFit** penalises running away from `optimalDistance` (energy when longer,
  top speed when shorter).
* **weightMod** (handicaps): −0.12 % per kg above 55 kg.
* **Stress:** big-prestige races cost up to 1.5 % × (1 − stressResistance/100).
* **Jockey:** skill reduces pace-judgement noise, improves the break and lane choice;
  horse–jockey synergy is ±1 %.

### I.2 Per tick
1. Race phase from distance fraction: EARLY (<25 %), MIDDLE (<75 %), LATE, KICK
   (last `kickDistance = 250 + finalKick·2.5` m).
2. Target effort from the **strategy** pace plan (FRONT_RUNNER, PACE_SETTER, MID_PACK,
   CLOSER, CONSERVATIVE, AGGRESSIVE), re-planned mid-race (§I.2b); keen horses
   (low temperament) restrained off the pace waste energy ("pulling").
3. Energy drain ∝ `effort⁴ × drainEff` per second, plus pace-pressure when duelling for
   the lead, wind resistance for the leader, and a drafting saving behind another horse.
4. Out of energy → speed falls toward `(0.85 + courage·0.0005)·topSpeed`.
5. Traffic: a horse behind a slower horse in the same lane tries to switch out
   (success ∝ positioning + jockey), otherwise it is blocked (capped speed).
6. Turns: lane *k* adds `k·laneWidth/R` ground loss (≈1 %/lane); horses tuck toward the
   rail when clear; cornering reduces speed loss.
7. Start: reaction delay `0.2–0.8 s` from `start` attribute + jockey + noise.

Output: finishing order, times, margins, per-second frames (for replay/live), and a
typed event list (GOOD_BREAK, SLOW_START, LEAD_CHANGE, MOVE_UP, BLOCKED, KICK,
TIRING, PHOTO_FINISH, FINISH) that feeds commentary. Commentary is generated
**only** from these events.

### I.2b Calibration mechanics (added after validation)
* **Performance spread.** Every multiplicative speed modifier's deviation from the reference
  horse is compressed by `race.performanceSpread` (0.3); energy/efficiency differences by
  `race.energySpread` (0.15). The mapping is monotonic, so rankings are preserved while
  finishing margins stay in lengths rather than furlongs.
* **Energy-budgeted pace plan.** A strategy is a pace *shape*; the jockey scales it so the
  planned energy use matches the horse's reserve, misjudging by ±1.5 % × (1.2 − skill).
* **Mid-race re-planning.** In the MIDDLE/LATE phases the jockey blends the plan toward the
  effort the remaining energy can sustain to the line (weight 0.3 + 0.5·skill).
* **Fresh legs.** Energy beyond what the rest of the race needs at full effort becomes up to
  +5 % kick speed. Exhausted horses hold ≥ 85 % of top speed (+ courage).
* **Tactics wear.** Post-race fatigue/injury risk × 0.75 (CONSERVATIVE) … × 1.2 (AGGRESSIVE).

### I.3 Fairness
Seed = `HMAC(serverSecret, raceId)`; `sha256(seed)` is published when the race
locks and the seed is revealed after completion (commit–reveal), so results are
verifiable and cannot be re-rolled by the server silently.

### I.4 Validation targets (checked by `pnpm sim:races`)

| Metric | Target |
|---|---|
| Win rate of ability-rating favourite (10-runner field) | 30–45 % |
| Favourite finishes top 3 | 60–80 % |
| Spearman(ability, finish) | 0.45–0.80 |
| Win rate of the weakest horse | > 0 %, < 3 % |
| Any strategy's share of wins (equal horses) | 8–30 % each |
| Draw (gate) bias, best vs worst gate win share | < 1.6× |
| Median winning margin | < 5 lengths |
| Median margin winner → last | < 35 lengths |
| Deterministic replay (same seed) | 100 % identical |

### I.5 Rewards
Prize money (credits) split 50/22/13/8/5/2 % over the top 6. Reputation for top 3.
raceRating: multi-player Elo, K = 32/(n−1) per pair.

## J. Tournament System (Phase 2 — implemented)

Tiers (config `tournaments.tiers`; only the first four are live — International/World are
reserved for a larger player base):

| Tier | Every | Entry | Final purse | Qualification (either) | Heat/final class | Champion bonus |
|---|---|---|---|---|---|---|
| Local | 24 h (18:00 UTC) | 200 | 6 000 | open | Class 5 | +30 reputation |
| Regional | 72 h | 500 | 15 000 | 20 season pts or rating 1100+ | Class 4 | +1 prestige, +60 rep |
| National | 7 days | 1 200 | 40 000 | 60 season pts or rating 1200+ | Class 3 | +2 prestige, +120 rep |
| Elite | 14 days | 3 000 | 100 000 | 150 season pts or rating 1300+ | Class 2 | +5 prestige, +250 rep |

Qualification is **never purchasable** (season points are earned; rating is Elo).

Lifecycle (`REGISTRATION → HEATS → FINAL → COMPLETED`, or `CANCELLED`):

1. **Registration** opens 24 h before the heats and closes 10 min before. Max 2 horses per
   owner; the horse must be idle, of racing age, healthy and fresh enough at the heats time.
   The fee is burnt (`TOURNAMENT_FEES`) and the horse is committed (`ENTERED`) — no training
   or other races until it is eliminated or the final is run. Withdrawal before the close
   refunds in full; re-registration is allowed (fresh idempotency key).
2. **Draw** at close: < 2 entrants → cancelled with refunds. ≤ 6 entrants → straight to a
   final at the heats time. Otherwise ⌈n/6⌉ heats, snake-seeded by race rating so the best
   horses are spread out, 3 minutes apart. Heats are ordinary races (purse 0, no fee,
   house fillers to 8 runners, provably fair seeds) and cannot be entered directly.
3. **Advance** when every heat is decided: the top 2 player finishers of each heat qualify;
   a qualifier that was injured, sold or retired in the meantime is scratched. A cancelled
   heat scratches and refunds its runners.
4. **Final** 30 min after the heats: ordinary race carrying the tournament purse (normal
   prize split). The best player finisher is champion (tier bonus via `TOURNAMENT_PRIZE`).
   A cancelled final refunds every finalist.

Heats and finals award season points like any race of their class. Every step is one
transaction guarded by status + row lock, so the job can run on any number of workers.

## Race classes (MVP)

| Class | Eligibility | Entry fee | Base purse |
|---|---|---|---|
| MAIDEN | 0 wins | 100 | 1 500 |
| CLASS_5 | raceRating < 1 100 | 150 | 2 400 |
| CLASS_4 | 1 050–1 200 | 250 | 3 900 |
| CLASS_3 | 1 150–1 300 | 400 | 6 300 |
| CLASS_2 | 1 250–1 400 | 650 | 10 300 |
| CLASS_1 | ≥ 1 350 | 1 000 | 16 300 |

Fields below the minimum size are filled with house (NPC) horses of matching class
so races always run, even with few players. House quality rises by class (config
`houseQuality`, e.g. Maiden 0.18–0.42 … Class 1 0.76–0.95) because house horses are generated
untrained while player horses are trained; the bands were set by the economy simulation.

## Tracks & weather

10 track archetypes (Urban, Desert, European Turf, American Dirt, Mountain, Coastal
Wet, Night, Elite Stadium, Country, Experimental Synthetic) each with surface, turn
fraction, straight length, elevation, going sensitivity, prestige.
Weather: SUNNY, CLOUDY, RAIN, HEAVY_RAIN, WIND, FOG, HEAT, COLD — rain moves the going
softer; wind taxes leaders; heat increases drain; fog increases positioning noise.
