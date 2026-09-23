import type { GameConfig } from "../config/index.js";
import { clamp } from "../math.js";

const MS_PER_DAY = 86_400_000;

export type LifeStage = "FOAL" | "YEARLING" | "JUVENILE" | "PRIME" | "VETERAN" | "RETIRED";

/** Age in (fractional) game years. */
export function ageInYears(birthAt: Date, now: Date, cfg: GameConfig): number {
  return Math.max(0, (now.getTime() - birthAt.getTime()) / (cfg.lifecycle.realDaysPerGameYear * MS_PER_DAY));
}

/** Birth timestamp that makes a horse exactly `years` old at `now`. */
export function birthDateForAge(years: number, now: Date, cfg: GameConfig): Date {
  return new Date(now.getTime() - years * cfg.lifecycle.realDaysPerGameYear * MS_PER_DAY);
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
