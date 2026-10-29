import type { GameConfig } from "../config/index.js";
import { clamp } from "../math.js";

const MS_PER_DAY = 86_400_000;

export type LifeStage = "FOAL" | "YEARLING" | "JUVENILE" | "PRIME" | "VETERAN" | "RETIRED";

/**
 * Real milliseconds per game year: growing up (to `slowAgingFromAge`) goes at
 * `realDaysPerGameYear`, a racing career at `adultRealDaysPerGameYear`, so foals still reach
 * the track in a few weeks while careers last months.
 */
function yearMs(cfg: GameConfig) {
  const l = cfg.lifecycle;
  return {
    young: l.realDaysPerGameYear * MS_PER_DAY,
    adult: l.adultRealDaysPerGameYear * MS_PER_DAY,
    at: l.slowAgingFromAge,
  };
}

/** Age in (fractional) game years. */
export function ageInYears(birthAt: Date, now: Date, cfg: GameConfig): number {
  const { young, adult, at } = yearMs(cfg);
  const ms = Math.max(0, now.getTime() - birthAt.getTime());
  return ms <= at * young ? ms / young : at + (ms - at * young) / adult;
}

/** Real milliseconds a horse takes to grow from birth to `years` old. */
export function realMsForAge(years: number, cfg: GameConfig): number {
  const { young, adult, at } = yearMs(cfg);
  const y = Math.max(0, years);
  return y <= at ? y * young : at * young + (y - at) * adult;
}

/** Birth timestamp that makes a horse exactly `years` old at `now`. */
export function birthDateForAge(years: number, now: Date, cfg: GameConfig): Date {
  return new Date(now.getTime() - realMsForAge(years, cfg));
}

export function lifeStage(age: number, cfg: GameConfig): LifeStage {
  if (age >= cfg.lifecycle.forcedRetireAge) return "RETIRED";
  if (age < 1) return "FOAL";
  if (age < 2) return "YEARLING";
  if (age < 3) return "JUVENILE";
  if (age < 6) return "PRIME";
  return "VETERAN";
}

/** Training response multiplier; late developers (maturity > 0) keep improving longer. */
export function ageTrainingMultiplier(age: number, maturity: number, cfg: GameConfig): number {
  const table = cfg.lifecycle.ageTrainingMultiplier;
  const effective = clamp(Math.floor(age - maturity * 0.75), 0, 9);
  return table[effective] ?? 0;
}

export function canRaceAtAge(age: number, cfg: GameConfig): boolean {
  return age >= cfg.lifecycle.minRacingAge && age < cfg.lifecycle.forcedRetireAge;
}
