import { mean } from "../math.js";
import { abilityRating } from "./rating.js";
import { TRAINABLE_ATTRIBUTES, type Attributes, type Genome, type Rarity } from "./types.js";

const RARITY_MULT: Record<Rarity, number> = { COMMON: 1, UNCOMMON: 1.1, RARE: 1.25, EPIC: 1.5, LEGENDARY: 2 };

export const averageCeiling = (genome: Pick<Genome, "ceilings">): number =>
  mean(TRAINABLE_ATTRIBUTES.map((a) => genome.ceilings[a]));

/** 1–5 star summary of genetic potential shown to owners without paid diagnostics. */
export function potentialStars(genome: Pick<Genome, "ceilings">): number {
  const avg = averageCeiling(genome);
  return avg < 50 ? 1 : avg < 58 ? 2 : avg < 66 ? 3 : avg < 74 ? 4 : 5;
}

/**
 * Reference market value in credits (primary sales, price sanity bands for P2 marketplace).
 * Current ability dominates; potential matters more for young horses.
 */
export function horseValuation(genome: Genome, attributes: Attributes, age: number): number {
  const ability = abilityRating(attributes, genome.traits);
  const potential = averageCeiling(genome);
  const youth = age < 3 ? 1.2 : age < 5 ? 1 : age < 7 ? 0.7 : 0.4;
  const value =
    (25 * Math.max(0, ability - 20) ** 1.6 + 15 * youth * Math.max(0, potential - 40) ** 1.7) *
    RARITY_MULT[genome.rarity] *
    (age < 7 ? 1 : 0.6);
  return Math.max(500, Math.round(value / 50) * 50);
}
