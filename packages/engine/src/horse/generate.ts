import type { GameConfig } from "../config/index.js";
import { clamp, round } from "../math.js";
import type { Rng } from "../rng.js";
import { BLOODLINES } from "./names.js";
import {
  COATS,
  RARITIES,
  SURFACES,
  TRAINABLE_ATTRIBUTES,
  TRAITS,
  type Attributes,
  type Genome,
  type Rarity,
  type Traits,
} from "./types.js";

export interface GenerateGenomeOptions {
  /** 0 (weak) – 1 (elite): shifts the mean of attribute ceilings. */
  quality: number;
  rarity?: Rarity;
  bloodline?: string;
}

export function rollRarity(rng: Rng, cfg: GameConfig): Rarity {
  return rng.weighted(RARITIES.map((r) => [r, cfg.generation.rarityWeights[r]] as const));
}

/** Create a random genome (used for house horses, primary sales, starter horses). */
export function generateGenome(rng: Rng, opts: GenerateGenomeOptions, cfg: GameConfig): Genome {
  const quality = clamp(opts.quality, 0, 1);
  const rarity = opts.rarity ?? rollRarity(rng, cfg);
  const mean = cfg.generation.ceilingBase + quality * cfg.generation.ceilingRange;
  const sd = cfg.generation.raritySpread[rarity];

  const ceilings = {} as Attributes;
  for (const a of TRAINABLE_ATTRIBUTES) ceilings[a] = round(clamp(rng.normal(mean, sd), 20, 99), 1);
  for (let i = 0; i < cfg.generation.rarityGifts[rarity]; i++) {
    const a = rng.pick(TRAINABLE_ATTRIBUTES);
    ceilings[a] = round(clamp(ceilings[a] + rng.int(6, 12), 20, 99), 1);
  }

  const traits = {} as Traits;
  for (const t of TRAITS) traits[t] = round(clamp(rng.normal(50 + quality * 12, 15), 5, 99), 1);

  const favoured = rng.pick(SURFACES);
  const surface = {} as Genome["aptitudes"]["surface"];
  for (const s of SURFACES) {
    surface[s] = round(clamp(s === favoured ? rng.normal(72, 10) : rng.normal(45, 12), 5, 99), 1);
  }

  return {
    ceilings,
    traits,
    aptitudes: {
      surface,
      wet: round(clamp(rng.normal(50, 18), 5, 99), 1),
      optimalDistance: Math.round(clamp(rng.normal(1700, 380), 1000, 3200) / 50) * 50,
      distanceRange: round(clamp(rng.normal(50, 18), 5, 99), 1),
    },
    hidden: {
      injurySusceptibility: round(clamp(rng.normal(1, 0.18), 0.5, 1.5), 3),
      maturity: round(clamp(rng.normal(0, 0.5), -1, 1), 3),
      raceIntelligence: round(clamp(rng.normal(50 + quality * 10, 15), 5, 99), 1),
      adaptability: round(clamp(rng.normal(50, 15), 5, 99), 1),
    },
    coat: rng.pick(COATS),
    rarity,
    bloodline: opts.bloodline ?? rng.pick(BLOODLINES),
  };
}

/** Share of genetic ceiling already realized at a given age (before any player training). */
export function developmentAtAge(age: number): number {
  if (age < 1) return 0.35;
  if (age < 2) return 0.5;
  if (age < 3) return 0.62;
  if (age < 4) return 0.75;
  if (age < 5) return 0.82;
  return 0.85;
}

/** Current attributes for a freshly generated horse of the given age. */
export function initialAttributes(genome: Genome, age: number, rng: Rng): Attributes {
  const dev = developmentAtAge(age);
  const out = {} as Attributes;
  for (const a of TRAINABLE_ATTRIBUTES) {
    const c = genome.ceilings[a];
    out[a] = round(clamp(c * dev * (1 + rng.normal(0, 0.04)), 1, c), 1);
  }
  return out;
}
