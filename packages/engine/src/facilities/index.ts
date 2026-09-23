import { FACILITY_TYPES, type FacilityType, type GameConfig } from "../config/index.js";
import { round } from "../math.js";

export type FacilityLevels = Record<FacilityType, number>;

export const NO_FACILITIES: FacilityLevels = { TRAINING_TRACK: 0, VET_CLINIC: 0 };

export function facilityMaxLevel(type: FacilityType, cfg: GameConfig): number {
  return cfg.facilities[type].costs.length;
}

/** Cost of building the next level, or null at max level. */
export function facilityUpgradeCost(type: FacilityType, current: number, cfg: GameConfig): number | null {
  return cfg.facilities[type].costs[current] ?? null;
}

export function facilityRequiredStableLevel(nextLevel: number, cfg: GameConfig): number {
  return nextLevel + cfg.facilities.stableLevelOffset;
}

/** Combined effect of the stable's facilities on a training session. */
export function facilityEffect(levels: FacilityLevels, cfg: GameConfig) {
  let gain = 1;
  let injury = 1;
  for (const t of FACILITY_TYPES) {
    const f = cfg.facilities[t];
    const lv = Math.max(0, Math.min(levels[t] ?? 0, f.costs.length));
    gain *= 1 + f.gainPerLevel * lv;
    injury *= 1 - f.injuryReductionPerLevel * lv;
  }
  return { gainMultiplier: round(gain, 3), injuryMultiplier: round(Math.max(0.3, injury), 3) };
}
