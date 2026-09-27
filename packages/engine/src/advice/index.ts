import { type GameConfig, TRAINING_TYPES, type TrainingType } from "../config/index.js";
import type { Aptitudes, Attributes, TrainableAttribute } from "../horse/types.js";

export type DistanceProfile = "SPRINTER" | "MILER" | "STAYER";

export const distanceProfile = (optimalDistance: number): DistanceProfile =>
  optimalDistance <= 1400 ? "SPRINTER" : optimalDistance >= 2000 ? "STAYER" : "MILER";

/** How much each attribute matters for a horse's natural trip (a rough guide, not the simulation). */
const NEEDS: Record<DistanceProfile, Partial<Record<TrainableAttribute, number>>> = {
  SPRINTER: { speed: 1, acceleration: 0.9, start: 0.8, finalKick: 0.5, stamina: 0.2 },
  MILER: { speed: 0.9, finalKick: 0.8, stamina: 0.6, acceleration: 0.5, cornering: 0.4 },
  STAYER: { stamina: 1, endurance: 0.9, finalKick: 0.5, speed: 0.5, focus: 0.3 },
};

export interface TrainingAdvice {
  profile: DistanceProfile;
  /** The attribute with the largest weighted gap for this horse's trip. */
  attribute: TrainableAttribute;
  type: TrainingType;
}

/**
 * Suggest the next training session from what the owner can already see (current attributes and
 * the horse's best distance). Hidden genes and ceilings are never used, so advice leaks nothing.
 */
export function trainingAdvice(
  attributes: Attributes,
  aptitudes: Aptitudes,
  cfg: GameConfig,
): TrainingAdvice {
  const profile = distanceProfile(aptitudes.optimalDistance);
  let attribute: TrainableAttribute = "speed";
  let worst = -1;
  for (const [k, need] of Object.entries(NEEDS[profile]) as [TrainableAttribute, number][]) {
    const gap = need * (100 - attributes[k]);
    if (gap > worst) {
      worst = gap;
      attribute = k;
    }
  }
  let type: TrainingType = "SPEED";
  let best = -1;
  for (const t of TRAINING_TYPES) {
    const tc = cfg.training.types[t];
    const w = tc.weights[attribute] ?? 0;
    // Prefer the session that trains it hardest; on a tie, the less tiring one.
    const score = w - tc.baseFatigue / 1000;
    if (w > 0 && score > best) {
      best = score;
      type = t;
    }
  }
  return { profile, attribute, type };
}

/**
 * How well a race suits a horse (lower is better): distance off its best trip plus a surface
 * penalty. Used to rank open races the horse is eligible for.
 */
export function raceFit(
  aptitudes: Aptitudes,
  race: { distance: number; surface: keyof Aptitudes["surface"] },
): number {
  const distance = Math.abs(race.distance - aptitudes.optimalDistance) / aptitudes.optimalDistance;
  const surface = (100 - aptitudes.surface[race.surface]) / 100;
  return distance + 0.5 * surface;
}
