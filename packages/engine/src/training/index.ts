import type { GameConfig, TrainingIntensity, TrainingType } from "../config/index.js";
import { ageTrainingMultiplier } from "../horse/lifecycle.js";
import type { Attributes, Condition, Genome, TrainableAttribute } from "../horse/types.js";
import { clamp, round } from "../math.js";
import type { Rng } from "../rng.js";

export type InjurySeverity = "MINOR" | "MODERATE";

export interface InjuryOutcome {
  severity: InjurySeverity;
  hours: number;
  /** Probability that was rolled against — stored for explainability. */
  chance: number;
  factors: { intensity: number; fatigue: number; susceptibility: number };
}

export interface TrainingInput {
  type: TrainingType;
  intensity: TrainingIntensity;
  attributes: Attributes;
  genome: Pick<Genome, "ceilings" | "hidden">;
  condition: Condition;
  age: number;
  sessionsLast24h: number;
  trainerMultiplier?: number;
  facilityMultiplier?: number;
}

export interface TrainingOutcome {
  gains: Partial<Record<TrainableAttribute, number>>;
  attributes: Attributes;
  fatigue: number;
  health: number;
  injury: InjuryOutcome | null;
  factors: {
    ageMultiplier: number;
    fatigueEfficiency: number;
    repeatDecay: number;
    randomFactor: number;
  };
}

export type TrainingBlockReason = "TOO_FATIGUED" | "HEALTH_TOO_LOW" | "TOO_YOUNG" | "TOO_OLD";

export function trainingCost(type: TrainingType, intensity: TrainingIntensity, cfg: GameConfig): number {
  return Math.round(cfg.training.types[type].cost * cfg.training.intensity[intensity].cost);
}

export function trainingDurationMinutes(
  type: TrainingType,
  intensity: TrainingIntensity,
  cfg: GameConfig,
): number {
  const base = cfg.training.types[type].durationMinutes;
  return intensity === "HARD"
    ? Math.round(base * 1.25)
    : intensity === "LIGHT"
      ? Math.round(base * 0.75)
      : base;
}

export function trainingBlockReason(
  condition: Condition,
  age: number,
  type: TrainingType,
  cfg: GameConfig,
): TrainingBlockReason | null {
  if (age < 1) return "TOO_YOUNG";
  if (age >= cfg.lifecycle.forcedRetireAge) return "TOO_OLD";
  // Recovery sessions are always allowed so a horse can be nursed back.
  if (type === "RECOVERY") return null;
  if (condition.fatigue >= cfg.condition.maxFatigueToTrain) return "TOO_FATIGUED";
  if (condition.health < cfg.condition.minHealthToTrain) return "HEALTH_TOO_LOW";
  return null;
}

/**
 * Resolve a training session. Gains shrink toward the genetic ceiling (never exceed it),
 * with fatigue, age and repetition penalties. Injury risk is bounded and explainable.
 */
export function resolveTraining(input: TrainingInput, rng: Rng, cfg: GameConfig): TrainingOutcome {
  const t = cfg.training;
  const typeCfg = t.types[input.type];
  const int = t.intensity[input.intensity];

  const ageMultiplier = ageTrainingMultiplier(input.age, input.genome.hidden.maturity, cfg);
  const fatigueEfficiency =
    1 - t.fatigueEfficiencyLoss * (clamp(input.condition.fatigue, 0, 100) / 100) ** 1.3;
  const repeatDecay = t.repeatDecay ** Math.max(0, input.sessionsLast24h);
  const randomFactor = 1 + rng.float(-t.randomSpread, t.randomSpread);
  const common =
    t.baseGain *
    int.gain *
    ageMultiplier *
    fatigueEfficiency *
    repeatDecay *
    randomFactor *
    (input.trainerMultiplier ?? 1) *
    (input.facilityMultiplier ?? 1);

  const attributes: Attributes = { ...input.attributes };
  const gains: Partial<Record<TrainableAttribute, number>> = {};
  for (const [attr, weight] of Object.entries(typeCfg.weights) as [TrainableAttribute, number][]) {
    const ceiling = input.genome.ceilings[attr];
    const current = attributes[attr];
    const headroom = ceiling > 0 ? Math.max(0, 1 - current / ceiling) ** t.headroomExponent : 0;
    const gain = Math.min(ceiling - current, common * weight * headroom);
    if (gain > 0) {
      attributes[attr] = round(current + gain, 2);
      gains[attr] = round(gain, 2);
    }
  }

  const endurance = input.attributes.endurance;
  let fatigue = input.condition.fatigue + typeCfg.baseFatigue * int.fatigue * (1 - endurance / 400);
  let health = input.condition.health;
  if (typeCfg.fatigueRelief) fatigue -= typeCfg.fatigueRelief * int.gain;
  if (typeCfg.healthRelief) health += typeCfg.healthRelief * int.gain;
  fatigue = clamp(fatigue, 0, 100);
  health = clamp(health, 0, 100);

  let injury: InjuryOutcome | null = null;
  if (input.type !== "RECOVERY") {
    const susceptibility = input.genome.hidden.injurySusceptibility;
    const f = clamp(input.condition.fatigue, 0, 100) / 100;
    const chance = Math.min(
      t.maxInjuryChance,
      t.baseInjuryChance * int.injury * (1 + 4 * f * f) * susceptibility,
    );
    if (rng.chance(chance)) {
      const severity: InjurySeverity = rng.chance(t.moderateInjuryShare) ? "MODERATE" : "MINOR";
      injury = {
        severity,
        hours: t.injuryHours[severity],
        chance: round(chance, 5),
        factors: { intensity: int.injury, fatigue: round(input.condition.fatigue, 1), susceptibility },
      };
      health = clamp(health - (severity === "MODERATE" ? 30 : 12), 0, 100);
    }
  }

  return {
    gains,
    attributes,
    fatigue: round(fatigue, 2),
    health: round(health, 2),
    injury,
    factors: {
      ageMultiplier: round(ageMultiplier, 3),
      fatigueEfficiency: round(fatigueEfficiency, 3),
      repeatDecay: round(repeatDecay, 3),
      randomFactor: round(randomFactor, 3),
    },
  };
}
