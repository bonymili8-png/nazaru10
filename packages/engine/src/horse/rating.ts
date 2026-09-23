import type { Attributes, Traits } from "./types.js";

const WEIGHTS: Record<keyof Attributes, number> = {
  speed: 0.22,
  acceleration: 0.1,
  stamina: 0.14,
  endurance: 0.1,
  strength: 0.05,
  agility: 0.05,
  start: 0.06,
  cornering: 0.06,
  finalKick: 0.12,
  focus: 0.05,
};

/**
 * Displayed "ability rating" (roughly 20–100) — a weighted summary of current attributes
 * plus reliability traits. Used for matchmaking hints, valuation and UI; the simulation
 * itself never uses this number.
 */
export function abilityRating(
  attributes: Attributes,
  traits: Pick<Traits, "consistency" | "courage">,
): number {
  let sum = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as [keyof Attributes, number][]) sum += attributes[k] * w;
  sum = sum * 0.95 + traits.consistency * 0.025 + traits.courage * 0.025;
  return Math.round(sum * 10) / 10;
}
