import { sessionFor, trainingPriorities } from "../advice/advanced.js";
import type { GameConfig, TrainingIntensity, TrainingType } from "../config/index.js";
import type { Aptitudes, Attributes, Condition, TrainableAttribute } from "../horse/types.js";
import { trainingBlockReason } from "./index.js";

/** The auto-trainer's two daily runs, in the owner's local time. */
export type AutoSlot = "MORNING" | "AFTERNOON";

export type AutoSkip = "NOT_RESTED" | "UNSAFE" | "HEALTH" | "TOO_YOUNG" | "TOO_OLD" | "NOTHING_TO_TRAIN";

export type AutoPlan =
  { type: TrainingType; intensity: TrainingIntensity; attribute: TrainableAttribute } | { skip: AutoSkip };

/** Which run (if any) the owner's local hour falls in. */
export function autoSlotAt(localHour: number, cfg: GameConfig): AutoSlot | null {
  const a = cfg.autoTrainer;
  if (localHour >= a.morningHour && localHour < a.afternoonHour) return "MORNING";
  if (localHour >= a.afternoonHour && localHour < a.lastHour) return "AFTERNOON";
  return null;
}

/**
 * What the auto-trainer does with one free horse in a run.
 *
 * Morning: only a fully rested horse (no fatigue). It trains the attribute that matters most for
 * the horse's trip (need × room left), then on later runs balances across the next ones: each
 * session trained recently halves that attribute's turn. Hard when the horse is in its prime
 * and healthy, normal otherwise (light for yearlings).
 * Afternoon: a second, normal session on another attribute, only when it is safe — fatigue low
 * now and still well clear of the limit after the session, health comfortable.
 */
export function autoTrainingPlan(
  input: {
    slot: AutoSlot;
    attributes: Attributes;
    aptitudes: Aptitudes;
    condition: Condition;
    age: number;
    /** Types of the auto-trainer's sessions on this horse over the last days, newest first. */
    recent: TrainingType[];
  },
  cfg: GameConfig,
): AutoPlan {
  const a = cfg.autoTrainer;
  const { condition, age } = input;
  const block = trainingBlockReason(condition, age, "SPEED", cfg);
  if (block === "TOO_YOUNG" || block === "TOO_OLD") return { skip: block };
  if (block === "HEALTH_TOO_LOW") return { skip: "HEALTH" };
  const yearling = age < cfg.lifecycle.minRacingAge;

  let intensity: TrainingIntensity;
  if (input.slot === "MORNING") {
    if (condition.fatigue > a.morningMaxFatigue) return { skip: "NOT_RESTED" };
    intensity = yearling
      ? "LIGHT"
      : age < cfg.lifecycle.voluntaryRetireAge && condition.health >= a.hardMinHealth
        ? "HARD"
        : "NORMAL";
  } else {
    if (condition.fatigue > a.afternoonMaxFatigue) return { skip: "UNSAFE" };
    if (condition.health < cfg.condition.minHealthToTrain + a.afternoonHealthMargin)
      return { skip: "HEALTH" };
    intensity = yearling ? "LIGHT" : "NORMAL";
  }

  // Balance: an attribute's turn halves with each recent session of its type.
  const lastType = input.recent[0];
  const candidates = trainingPriorities(input.attributes, input.aptitudes)
    .slice(0, a.rotation)
    .map((c) => {
      const type = sessionFor(c.attribute, cfg);
      const times = input.recent.filter((t) => t === type).length;
      return { ...c, type, score: c.gap * 0.5 ** times };
    })
    // The afternoon never repeats the morning's session.
    .filter((c) => input.slot === "MORNING" || c.type !== lastType)
    .sort((x, y) => y.score - x.score);
  const pick = candidates[0];
  if (!pick) return { skip: "NOTHING_TO_TRAIN" };

  if (input.slot === "AFTERNOON") {
    const t = cfg.training;
    const after =
      condition.fatigue +
      t.types[pick.type].baseFatigue *
        t.intensity[intensity].fatigue *
        (1 - input.attributes.endurance / 400);
    if (after > a.afternoonMaxFatigueAfter) return { skip: "UNSAFE" };
  }
  return { type: pick.type, intensity, attribute: pick.attribute };
}
