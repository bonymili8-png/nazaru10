import type { FeedPlan, GameConfig } from "../config/index.js";
import { clamp } from "../math.js";
import type { Condition } from "./types.js";

export interface StoredCondition extends Condition {
  updatedAt: Date;
}

/** How a feed plan changes recovery between sessions. */
export interface FeedEffect {
  recovery: number;
  regen: number;
  formDecay: number;
}

export const NO_FEED: FeedEffect = { recovery: 1, regen: 1, formDecay: 1 };

export function feedEffect(plan: FeedPlan, cfg: GameConfig): FeedEffect {
  if (plan === "STANDARD") return NO_FEED;
  const p = cfg.nutrition.plans[plan];
  return { recovery: p.recovery, regen: p.regen, formDecay: p.formDecay };
}

/** Weekly cost of a plan for one horse (0 for STANDARD). */
export const feedCost = (plan: FeedPlan, cfg: GameConfig): number =>
  plan === "STANDARD" ? 0 : cfg.nutrition.plans[plan].weeklyCost;

/**
 * Lazily project a stored condition to `now`. Fatigue recovers linearly, health regenerates,
 * form decays toward zero (slumps faster than streaks). Pure function → no cron needed and always explainable.
 */
export function projectCondition(
  stored: StoredCondition,
  now: Date,
  endurance: number,
  cfg: GameConfig,
  feed: FeedEffect = NO_FEED,
): Condition {
  const hours = Math.max(0, (now.getTime() - stored.updatedAt.getTime()) / 3_600_000);
  const rate = cfg.condition.fatigueRecoveryPerHour * (0.7 + endurance / 250) * feed.recovery;
  return {
    fatigue: clamp(stored.fatigue - rate * hours, 0, 100),
    health: clamp(stored.health + cfg.condition.healthRegenPerHour * feed.regen * hours, 0, 100),
    // A hot streak fades slowly (better feed holds it longer); a slump clears faster, and better
    // feed speeds that up too — feed never prolongs bad form.
    form:
      stored.form *
      (stored.form >= 0
        ? 1 - cfg.condition.formDecayPerDay * feed.formDecay
        : 1 - Math.min(0.9, cfg.condition.formRecoveryPerDay / feed.formDecay)) **
        (hours / 24),
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
/**
 * Race-day cost of fatigue. Fields are tight (a speed point is ≈ 0.23 %), so this must stay in
 * proportion with training: at the entry limit (50) it is ≈ −2 % speed, about 9 speed points —
 * rest clearly pays, but racing "fresh enough" no longer wipes out a trained horse's edge.
 */
export const fatigueModifier = (fatigue: number): number => 1 - 0.06 * (clamp(fatigue, 0, 100) / 100) ** 1.5;

export const healthModifier = (health: number): number => 0.85 + 0.15 * (clamp(health, 0, 100) / 100);

export const formModifier = (form: number): number => 1 + 0.02 * clamp(form, -1, 1);
