import { STRATEGIES, type GameConfig, type Strategy } from "../config/index.js";
import { generateGenome, initialAttributes } from "../horse/generate.js";
import { fatigueModifier, healthModifier } from "../horse/condition.js";
import { abilityRating } from "../horse/rating.js";
import { mean, spearman } from "../math.js";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
import { Rng } from "../rng.js";
import { simulateRace, type RaceEntrant } from "./simulate.js";
import { rollWeather, rollWetness, TRACKS } from "./track.js";

export interface RaceValidationReport {
  races: number;
  fieldSize: number;
  favouriteWinRate: number;
  favouriteTop3Rate: number;
  weakestWinRate: number;
  meanSpearman: number;
  gateWinShare: number[];
  gateBias: number;
  strategyWinShare: Record<Strategy, number>;
  meanWinnerSpeed: number;
  meanLeadChanges: number;
  deadHeats: number;
  /** Median lengths between 1st and 2nd. */
  medianWinningMargin: number;
  /** Median lengths between the winner and the last finisher. */
  medianLastMargin: number;
}

export function randomEntrant(
  rng: Rng,
  id: string,
  quality: number,
  cfg: GameConfig,
  strategy?: Strategy,
): RaceEntrant {
  const genome = generateGenome(rng, { quality }, cfg);
  const age = rng.float(3, 5.5);
  return {
    id,
    name: id,
    attributes: initialAttributes(genome, age, rng),
    traits: genome.traits,
    aptitudes: genome.aptitudes,
    raceIntelligence: genome.hidden.raceIntelligence,
    condition: { fatigue: rng.float(0, 30), health: rng.float(90, 100), form: 0 },
    strategy: strategy ?? rng.pick(STRATEGIES),
    jockey: { id: `j${rng.int(1, 40)}`, name: "J", skill: rng.float(40, 70) },
  };
}

/** Run a batch of random races and compute balance metrics (see GDD §I.4). */
export function validateRaces(
  races: number,
  seed: string,
  cfg: GameConfig,
  fieldSize = 10,
): RaceValidationReport {
  const rng = new Rng(`validation:${seed}`);
  let favWins = 0;
  let favTop3 = 0;
  let weakWins = 0;
  let deadHeats = 0;
  let leadChanges = 0;
  const rhos: number[] = [];
  const speeds: number[] = [];
  const winMargins: number[] = [];
  const lastMargins: number[] = [];
  const gateWins = new Array<number>(fieldSize).fill(0);

  for (let r = 0; r < races; r++) {
    const track = rng.pick(TRACKS);
    const distance = rng.pick(track.distances);
    const weather = rollWeather(track, rng);
    const wetness = rollWetness(track, weather, rng);
    const baseQ = rng.float(0.2, 0.8);
    // Owners enter horses at roughly suitable distances.
    const field = Array.from({ length: fieldSize }, (_, i) => {
      const e = randomEntrant(rng, `h${i}`, baseQ + rng.float(-0.12, 0.12), cfg);
      e.aptitudes = { ...e.aptitudes, optimalDistance: Math.round(distance * Math.exp(rng.normal(0, 0.15))) };
      return e;
    });
    // "Form guide" rating a punter would see: ability adjusted for current condition.
    const ratings = field.map(
      (e) =>
        abilityRating(e.attributes, e.traits) *
        fatigueModifier(e.condition.fatigue) *
        healthModifier(e.condition.health),
    );
    const res = simulateRace(field, { distance, track, weather, wetness }, `${seed}:${r}`, cfg);
    const pos = new Map(res.results.map((x) => [x.entrantId, x.position] as const));
    const fav = ratings.indexOf(Math.max(...ratings));
    const weak = ratings.indexOf(Math.min(...ratings));
    const favPos = pos.get(field[fav]!.id)!;
    if (favPos === 1) favWins++;
    if (favPos <= 3) favTop3++;
    if (pos.get(field[weak]!.id) === 1) weakWins++;
    rhos.push(
      spearman(
        ratings,
        field.map((e) => -pos.get(e.id)!),
      ),
    );
    speeds.push(distance / res.winningTime);
    winMargins.push(res.results[1]!.lengthsBehind);
    lastMargins.push(res.results[res.results.length - 1]!.lengthsBehind);
    gateWins[res.results[0]!.gate]!++;
    if (res.results.some((x) => x.deadHeat)) deadHeats++;
    leadChanges += res.events.filter((e) => e.type === "LEAD_CHANGE").length;
  }

  const strategyWinShare = strategyBalance(Math.max(200, Math.floor(races / 2)), seed, cfg);
  const gateWinShare = gateWins.map((w) => w / races);
  const nonZero = gateWinShare.filter((x) => x > 0);
  return {
    races,
    fieldSize,
    favouriteWinRate: favWins / races,
    favouriteTop3Rate: favTop3 / races,
    weakestWinRate: weakWins / races,
    meanSpearman: mean(rhos),
    gateWinShare,
    gateBias: nonZero.length
      ? Math.max(...gateWinShare) / Math.max(1e-9, Math.min(...gateWinShare))
      : Infinity,
    strategyWinShare,
    meanWinnerSpeed: mean(speeds),
    meanLeadChanges: leadChanges / races,
    deadHeats,
    medianWinningMargin: median(winMargins),
    medianLastMargin: median(lastMargins),
  };
}

/** Identical horses, one per strategy, random gates, tracks and distances. */
export function strategyBalance(races: number, seed: string, cfg: GameConfig): Record<Strategy, number> {
  const rng = new Rng(`strategy:${seed}`);
  const wins = Object.fromEntries(STRATEGIES.map((s) => [s, 0])) as Record<Strategy, number>;
  for (let r = 0; r < races; r++) {
    const track = rng.pick(TRACKS);
    const distance = rng.pick(track.distances);
    const weather = rollWeather(track, rng);
    const wetness = rollWetness(track, weather, rng);
    const template = randomEntrant(rng, "t", rng.float(0.3, 0.7), cfg);
    template.aptitudes = { ...template.aptitudes, optimalDistance: distance };
    const field = rng.shuffle(
      STRATEGIES.map((s) => ({
        ...template,
        id: s,
        name: s,
        strategy: s,
        jockey: { id: "same", name: "J", skill: 55 },
      })),
    );
    const res = simulateRace(field, { distance, track, weather, wetness }, `${seed}:s:${r}`, cfg);
    wins[res.results[0]!.entrantId as Strategy]++;
  }
  for (const s of STRATEGIES) wins[s] /= races;
  return wins;
}
