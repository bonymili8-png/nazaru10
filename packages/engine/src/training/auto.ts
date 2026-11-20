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
 * Both runs train a horse that is tired only as far as training still pays and stays safe:
 * fatigue at most `morningMaxFatigue` / `afternoonMaxFatigue` now (gains lose ≤ ~15 % and the
 * injury risk grows ≤ ~1.4× there), and at most `maxFatigueAfter` once the session is done, so
 * the horse recovers overnight. A tired horse waits: the trainer looks again every few minutes
 * while its run lasts. When the planned session would go past the limit it trains lighter
 * (hard → normal → light) or not at all.
 *
 * Morning: the attribute that matters most for the horse's trip (need × room left), then on
 * later runs it balances across the next ones: each session trained recently halves that
 * attribute's turn. Hard only when the horse is nearly fresh (fatigue ≤ `hardMaxFatigue`), in
 * its prime and healthy; normal otherwise (light for yearlings).
 * Afternoon: a second, normal session on another attribute.
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

  // A tired horse, or a second session in a day, needs a comfortable health margin too.
  if (
    (condition.fatigue > a.hardMaxFatigue || input.slot === "AFTERNOON") &&
    condition.health < cfg.condition.minHealthToTrain + a.healthMargin
  )
    return { skip: "HEALTH" };
  let intensity: TrainingIntensity;
  if (input.slot === "MORNING") {
    if (condition.fatigue > a.morningMaxFatigue) return { skip: "NOT_RESTED" };
    intensity = yearling
      ? "LIGHT"
      : age < cfg.lifecycle.voluntaryRetireAge &&
          condition.health >= a.hardMinHealth &&
          condition.fatigue <= a.hardMaxFatigue
        ? "HARD"
        : "NORMAL";
  } else {
    if (condition.fatigue > a.afternoonMaxFatigue) return { skip: "UNSAFE" };
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

  // Never past the safe limit once the session is done: train lighter, or not at all.
  const t = cfg.training;
  const after = (i: TrainingIntensity) =>
    condition.fatigue +
    t.types[pick.type].baseFatigue * t.intensity[i].fatigue * (1 - input.attributes.endurance / 400);
  const order: TrainingIntensity[] = ["HARD", "NORMAL", "LIGHT"];
  const fits = order.slice(order.indexOf(intensity)).find((i) => after(i) <= a.maxFatigueAfter);
  if (!fits) return { skip: input.slot === "MORNING" ? "NOT_RESTED" : "UNSAFE" };
  intensity = fits;
  return { type: pick.type, intensity, attribute: pick.attribute };
}
