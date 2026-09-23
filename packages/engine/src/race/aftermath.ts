import type { GameConfig, Strategy } from "../config/index.js";
import type { Condition } from "../horse/types.js";
import { clamp, round } from "../math.js";
import type { Rng } from "../rng.js";

const STRATEGY_WEAR: Record<Strategy, number> = {
  FRONT_RUNNER: 1.05,
  PACE_SETTER: 1,
  MID_PACK: 1,
  CLOSER: 0.95,
  CONSERVATIVE: 0.75,
  AGGRESSIVE: 1.2,
};

export interface RaceAftermath {
  condition: Condition;
  injury: { severity: "MINOR" | "MODERATE"; hours: number; chance: number } | null;
}

/**
 * Condition change for a horse after running. Form moves toward how the horse did relative
 * to the field (expected rank from pre-race ability order). Injury risk is small and bounded.
 */
export function raceAftermath(
  before: Condition,
  input: {
    distance: number;
    position: number;
    expectedPosition: number;
    fieldSize: number;
    endurance: number;
    susceptibility: number;
    strategy?: Strategy;
  },
  rng: Rng,
  cfg: GameConfig,
): RaceAftermath {
  const rc = cfg.race;
  // Riding tactics trade result for wear: conservative rides spare the horse, aggressive ones don't.
  const tactic = input.strategy ? STRATEGY_WEAR[input.strategy] : 1;
  const fatigue = clamp(
    before.fatigue +
      (rc.postRaceFatigueBase + (input.distance / 1000) * rc.postRaceFatiguePerKm) *
        (1 - input.endurance / 400) *
        tactic,
    0,
    100,
  );
  const surprise = (input.expectedPosition - input.position) / Math.max(1, input.fieldSize - 1);
  const form = clamp(before.form * 0.6 + surprise * 0.8, -1, 1);
  const chance = Math.min(
    0.03,
    rc.postRaceInjuryBase * (1 + 3 * (before.fatigue / 100) ** 2) * input.susceptibility * tactic,
  );
  let health = before.health;
  let injury: RaceAftermath["injury"] = null;
  if (rng.chance(chance)) {
    const severity = rng.chance(cfg.training.moderateInjuryShare) ? "MODERATE" : "MINOR";
    injury = { severity, hours: cfg.training.injuryHours[severity], chance: round(chance, 5) };
    health = clamp(health - (severity === "MODERATE" ? 30 : 12), 0, 100);
  }
  return {
    condition: { fatigue: round(fatigue, 2), health: round(health, 2), form: round(form, 3) },
    injury,
  };
}
