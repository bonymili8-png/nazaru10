import type { GameConfig } from "../config/index.js";
import type { Surface } from "../horse/types.js";
import { Rng } from "../rng.js";

/** What a sponsor asks for: a number of qualifying runs within the contract. */
export interface SponsorGoal {
  /** START = any finish; TOP3 = placed 1st–3rd; WIN = won. */
  result: "START" | "TOP3" | "WIN";
  surface?: Surface;
  minDistance?: number;
  maxDistance?: number;
  /** Going at least this wet (0 firm … 3 heavy). */
  minWetness?: number;
  count: number;
}

export interface SponsorDef {
  code: string;
  name: string;
  goal: SponsorGoal;
  /** Credits paid on completion. */
  reward: number;
  reputation: number;
}

/** The facts of one finished run that sponsors look at. */
export interface SponsoredRun {
  surface: Surface;
  distance: number;
  wetness: number;
  position: number;
}

export function sponsorQualifies(goal: SponsorGoal, run: SponsoredRun): boolean {
  if (goal.surface && run.surface !== goal.surface) return false;
  if (goal.minDistance !== undefined && run.distance < goal.minDistance) return false;
  if (goal.maxDistance !== undefined && run.distance > goal.maxDistance) return false;
  if (goal.minWetness !== undefined && run.wetness < goal.minWetness) return false;
  if (goal.result === "WIN") return run.position === 1;
  if (goal.result === "TOP3") return run.position <= 3;
  return true;
}

/** Contract week index (weeks since the Unix epoch, Monday 00:00 UTC boundaries). */
export const sponsorWeek = (at: Date): number => Math.floor((at.getTime() / 86_400_000 + 3) / 7);

/** Start of a contract week. */
export const sponsorWeekStart = (week: number): Date => new Date((week * 7 - 3) * 86_400_000);

/** The sponsors offering this owner a contract this week (deterministic per owner and week). */
export function sponsorOffers(ownerId: string, week: number, cfg: GameConfig): SponsorDef[] {
  const rng = new Rng(`sponsor:${ownerId}:${week}`);
  return rng.shuffle([...cfg.sponsors.catalog]).slice(0, cfg.sponsors.offersPerWeek);
}
