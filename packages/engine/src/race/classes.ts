import { type GameConfig, RACE_CLASSES, type RaceClass } from "../config/index.js";

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
