import { type GameConfig, RACE_CLASSES, type RaceClass } from "../config/index.js";
import { generateGenome, initialAttributes } from "../horse/generate.js";
import { abilityRating } from "../horse/rating.js";
import { Rng } from "../rng.js";

/** Rated classes (everything but MAIDEN), lowest band first. */
export const RATED_CLASSES = RACE_CLASSES.filter((c) => c !== "MAIDEN") as Exclude<RaceClass, "MAIDEN">[];

/** Whether a race rating falls inside a class's inclusive band. */
export function inRatingBand(
  rating: number,
  band: { minRating: number | null; maxRating: number | null },
): boolean {
  return (
    (band.minRating === null || rating >= band.minRating) &&
    (band.maxRating === null || rating <= band.maxRating)
  );
}

/**
 * The classes a horse may enter by its record and race rating: MAIDEN while it has never won,
 * plus the single rated class whose band holds its rating. Age and status are checked separately.
 */
export function eligibleClasses(rating: number, wins: number, cfg: GameConfig): RaceClass[] {
  const out: RaceClass[] = [];
  for (const c of RACE_CLASSES) {
    const cc = cfg.race.classes[c];
    if (cc.maidenOnly && wins > 0) continue;
    if (inRatingBand(rating, cc)) out.push(c);
  }
  return out;
}

/**
 * Rated class bands must tile the rating line: the lowest open below, the highest open above,
 * and each band starting exactly one point above the previous one's top. So every rating fits
 * exactly one rated class. Returns human-readable problems (empty = valid).
 */
export function classBandProblems(cfg: GameConfig): string[] {
  const problems: string[] = [];
  const bands = RATED_CLASSES.map((c) => ({ c, ...cfg.race.classes[c] }));
  if (bands[0]!.minRating !== null) problems.push(`race.classes.${bands[0]!.c}.minRating: must be null`);
  if (bands.at(-1)!.maxRating !== null)
    problems.push(`race.classes.${bands.at(-1)!.c}.maxRating: must be null`);
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!;
    if (b.maidenOnly) problems.push(`race.classes.${b.c}.maidenOnly: must be false`);
    if (b.minRating !== null && b.maxRating !== null && b.minRating > b.maxRating)
      problems.push(`race.classes.${b.c}: minRating is above maxRating`);
    if (i === 0) continue;
    const prev = bands[i - 1]!;
    if (prev.maxRating === null || b.minRating !== prev.maxRating + 1)
      problems.push(`race.classes.${b.c}.minRating: must be ${prev.c}.maxRating + 1`);
  }
  const maiden = cfg.race.classes.MAIDEN;
  if (!maiden.maidenOnly) problems.push("race.classes.MAIDEN.maidenOnly: must be true");
  return problems;
}

/** Cheapest entry fee among the classes a horse may enter (see `eligibleClasses`). */
export function cheapestEntryFee(rating: number, wins: number, cfg: GameConfig): number {
  return Math.min(...eligibleClasses(rating, wins, cfg).map((c) => cfg.race.classes[c].entryFee));
}

/**
 * The daily allowance for an owner below the threshold: the configured amount, raised if needed
 * so that the owner can afford at least one start for one of their horses. Without the top-up an
 * owner whose horses all rate into a class dearer than threshold + amount could never race again.
 */
export function allowanceAmount(
  credits: number,
  horses: { rating: number; wins: number }[],
  cfg: GameConfig,
): number {
  const { amount } = cfg.economy.allowance;
  if (horses.length === 0) return amount;
  const need = Math.min(...horses.map((h) => cheapestEntryFee(h.rating, h.wins, cfg)));
  return Math.max(amount, need - credits);
}

const capCache = new Map<string, number>();

/**
 * Highest ability rating a house horse may have to fill a race of this class: the 95th
 * percentile of the class's own house horses (quality and age drawn across their bands).
 * House horses that ended up in the pool from elsewhere (unsold sale-ring or limited-drop
 * horses, quality up to 0.75+) would otherwise line up against players as rivals far stronger
 * than the class promises. Deterministic, and cached per band.
 */
export function houseRatingCap(cls: RaceClass, cfg: GameConfig): number {
  const cc = cfg.race.classes[cls];
  const key = `${cls}:${cc.houseQuality.join("/")}:${cc.houseAge.join("/")}`;
  const hit = capCache.get(key);
  if (hit !== undefined) return hit;
  const rng = new Rng(`house-cap:${key}`);
  const ratings: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const g = generateGenome(rng, { quality: rng.float(...cc.houseQuality) }, cfg);
    ratings.push(abilityRating(initialAttributes(g, rng.float(...cc.houseAge), rng), g.traits));
  }
  ratings.sort((a, b) => a - b);
  const cap = ratings[Math.floor(ratings.length * 0.95)]!;
  capCache.set(key, cap);
  return cap;
}
