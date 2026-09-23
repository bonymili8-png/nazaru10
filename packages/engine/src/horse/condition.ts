import type { GameConfig } from "../config/index.js";
import { clamp } from "../math.js";
import type { Condition } from "./types.js";

export interface StoredCondition extends Condition {
  updatedAt: Date;
}

/**
 * Lazily project a stored condition to `now`. Fatigue recovers linearly, health regenerates,
 * form decays toward zero. Pure function → no cron needed and always explainable.
 */
export function projectCondition(
  stored: StoredCondition,
  now: Date,
  endurance: number,
  cfg: GameConfig,
  recoveryMultiplier = 1,
): Condition {
  const hours = Math.max(0, (now.getTime() - stored.updatedAt.getTime()) / 3_600_000);
  const rate = cfg.condition.fatigueRecoveryPerHour * (0.7 + endurance / 250) * recoveryMultiplier;
  return {
    fatigue: clamp(stored.fatigue - rate * hours, 0, 100),
    health: clamp(stored.health + cfg.condition.healthRegenPerHour * hours, 0, 100),
    form: stored.form * (1 - cfg.condition.formDecayPerDay) ** (hours / 24),
  };
}

/** Hours until fatigue falls to `target`. */
export function hoursUntilFatigue(
  fatigue: number,
  target: number,
  endurance: number,
  cfg: GameConfig,
  recoveryMultiplier = 1,
): number {
  if (fatigue <= target) return 0;
  const rate = cfg.condition.fatigueRecoveryPerHour * (0.7 + endurance / 250) * recoveryMultiplier;
  return (fatigue - target) / rate;
}

/** Multiplier (≤ 1) applied to top speed and energy for a tired horse. */
export const fatigueModifier = (fatigue: number): number => 1 - 0.25 * (clamp(fatigue, 0, 100) / 100) ** 1.5;

export const healthModifier = (health: number): number => 0.85 + 0.15 * (clamp(health, 0, 100) / 100);

export const formModifier = (form: number): number => 1 + 0.02 * clamp(form, -1, 1);
