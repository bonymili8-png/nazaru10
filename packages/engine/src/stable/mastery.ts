import type { GameConfig } from "../config/index.js";

export const MASTERY_TRACKS = ["TRAINING", "RACING", "BREEDING"] as const;
export type MasteryTrack = (typeof MASTERY_TRACKS)[number];

/** Experience an owner has built up, from what they actually did (never bought). */
export interface MasteryXp {
  /** Completed training sessions. */
  trainings: number;
  /** Race starts, and top-3 finishes (a podium counts as a start and again as a podium). */
  starts: number;
  podiums: number;
  /** Foals delivered. */
  foals: number;
}

export interface MasteryProgress {
  track: MasteryTrack;
  xp: number;
  level: number;
  maxLevel: number;
  /** XP needed for the next level (null at the top). */
  nextAt: number | null;
}

export interface MasteryPerks {
  /** Multiplier on training gains (1 = none). */
  trainingGain: number;
  /** Multiplier on post-race fatigue (1 = none; lower = the horse is ready sooner). */
  raceFatigue: number;
  /** Multiplier on gestation time (1 = none). */
  gestation: number;
}

export function masteryXp(track: MasteryTrack, xp: MasteryXp): number {
  if (track === "TRAINING") return xp.trainings;
  if (track === "RACING") return xp.starts + xp.podiums;
  return xp.foals;
}

export function masteryProgress(track: MasteryTrack, xp: MasteryXp, cfg: GameConfig): MasteryProgress {
  const thresholds = cfg.mastery.thresholds[track];
  const value = masteryXp(track, xp);
  const level = thresholds.filter((t) => value >= t).length;
  return { track, xp: value, level, maxLevel: thresholds.length, nextAt: thresholds[level] ?? null };
}

/**
 * Stable mastery: small, earned-only edges that grow with experience. They speed up progress
 * (training gains, readiness after a race, gestation) but never race-day strength directly,
 * and cannot be bought with credits or gems.
 */
export function masteryPerks(xp: MasteryXp, cfg: GameConfig): MasteryPerks {
  const m = cfg.mastery;
  const lvl = (t: MasteryTrack) => masteryProgress(t, xp, cfg).level;
  return {
    trainingGain: 1 + lvl("TRAINING") * m.trainingGainPerLevel,
    raceFatigue: 1 - lvl("RACING") * m.raceFatigueReliefPerLevel,
    gestation: 1 - lvl("BREEDING") * m.gestationCutPerLevel,
  };
}
