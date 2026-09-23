import type { GameConfig } from "../config/index.js";
import {
  RARITIES,
  SURFACES,
  TRAINABLE_ATTRIBUTES,
  TRAITS,
  COATS,
  type Attributes,
  type Genome,
  type Rarity,
  type Traits,
} from "../horse/types.js";
import { rollRarity } from "../horse/generate.js";
import { clamp, round } from "../math.js";
import type { Rng } from "../rng.js";

export interface Parent {
  id: string;
  genome: Genome;
}

/** id → parents (null for founders / unknown). */
export type Ancestry = ReadonlyMap<string, { sireId: string | null; damId: string | null }>;

function ancestorDepths(id: string, ancestry: Ancestry, maxDepth: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const walk = (node: string, depth: number) => {
    out.set(node, [...(out.get(node) ?? []), depth]);
    if (depth >= maxDepth) return;
    const p = ancestry.get(node);
    if (!p) return;
    if (p.sireId) walk(p.sireId, depth + 1);
    if (p.damId) walk(p.damId, depth + 1);
  };
  walk(id, 0);
  return out;
}

/**
 * Approximate Wright inbreeding coefficient of a prospective foal:
 * F = Σ_common ancestors Σ_paths (1/2)^(n1 + n2 + 1).
 */
export function inbreedingCoefficient(
  sireId: string,
  damId: string,
  ancestry: Ancestry,
  generations: number,
): number {
  const a = ancestorDepths(sireId, ancestry, generations - 1);
  const b = ancestorDepths(damId, ancestry, generations - 1);
  let f = 0;
  for (const [anc, depthsA] of a) {
    const depthsB = b.get(anc);
    if (!depthsB) continue;
    for (const d1 of depthsA) for (const d2 of depthsB) f += 0.5 ** (d1 + d2 + 1);
  }
  return Math.min(1, f);
}

export interface BreedingOutcome {
  genome: Genome;
  inbreeding: number;
  mutation: { attribute: keyof Attributes; amount: number } | null;
}

const mid = (a: number, b: number) => (a + b) / 2;

export function breed(
  sire: Parent,
  dam: Parent,
  ancestry: Ancestry,
  rng: Rng,
  cfg: GameConfig,
): BreedingOutcome {
  if (sire.id === dam.id) throw new RangeError("a horse cannot be bred with itself");
  const b = cfg.breeding;
  const s = sire.genome;
  const d = dam.genome;
  const F = inbreedingCoefficient(sire.id, dam.id, ancestry, b.inbreedingGenerations);

  const ceilings = {} as Attributes;
  const shared = rng.normal(0, b.sharedNoiseSd);
  for (const a of TRAINABLE_ATTRIBUTES) {
    const v =
      b.heritability * mid(s.ceilings[a], d.ceilings[a]) +
      (1 - b.heritability) * b.populationMean +
      shared +
      rng.normal(0, b.noiseSd) -
      F * b.inbreedingCeilingPenalty;
    ceilings[a] = round(clamp(v, 20, 99), 1);
  }
  let mutation: BreedingOutcome["mutation"] = null;
  if (rng.chance(b.mutationChance)) {
    const attribute = rng.pick(TRAINABLE_ATTRIBUTES);
    const amount = rng.int(b.mutationMin, b.mutationMax);
    ceilings[attribute] = round(clamp(ceilings[attribute] + amount, 20, 99), 1);
    mutation = { attribute, amount };
  }

  const traits = {} as Traits;
  for (const t of TRAITS)
    traits[t] = round(clamp(mid(s.traits[t], d.traits[t]) + rng.normal(0, 8), 5, 99), 1);

  const surface = {} as Genome["aptitudes"]["surface"];
  for (const sf of SURFACES) {
    surface[sf] = round(
      clamp(mid(s.aptitudes.surface[sf], d.aptitudes.surface[sf]) + rng.normal(0, 8), 5, 99),
      1,
    );
  }

  const idx = (r: Rarity) => RARITIES.indexOf(r);
  let rarityIdx = idx(rollRarity(rng, cfg));
  if (rng.chance(0.35)) rarityIdx = Math.max(rarityIdx, Math.min(idx(s.rarity), idx(d.rarity)));
  if (mutation) rarityIdx = Math.max(rarityIdx, idx("RARE"));

  const genome: Genome = {
    ceilings,
    traits,
    aptitudes: {
      surface,
      wet: round(clamp(mid(s.aptitudes.wet, d.aptitudes.wet) + rng.normal(0, 10), 5, 99), 1),
      optimalDistance:
        Math.round(
          clamp(
            mid(s.aptitudes.optimalDistance, d.aptitudes.optimalDistance) + rng.normal(0, 120),
            1000,
            3200,
          ) / 50,
        ) * 50,
      distanceRange: round(
        clamp(mid(s.aptitudes.distanceRange, d.aptitudes.distanceRange) + rng.normal(0, 8), 5, 99),
        1,
      ),
    },
    hidden: {
      injurySusceptibility: round(
        clamp(
          mid(s.hidden.injurySusceptibility, d.hidden.injurySusceptibility) + rng.normal(0, 0.08) + F,
          0.5,
          1.5,
        ),
        3,
      ),
      maturity: round(clamp(mid(s.hidden.maturity, d.hidden.maturity) + rng.normal(0, 0.3), -1, 1), 3),
      raceIntelligence: round(
        clamp(mid(s.hidden.raceIntelligence, d.hidden.raceIntelligence) + rng.normal(0, 10), 5, 99),
        1,
      ),
      adaptability: round(
        clamp(mid(s.hidden.adaptability, d.hidden.adaptability) + rng.normal(0, 10), 5, 99),
        1,
      ),
    },
    coat: rng.chance(0.05) ? rng.pick(COATS) : rng.chance(0.5) ? s.coat : d.coat,
    rarity: RARITIES[rarityIdx]!,
    bloodline: s.bloodline,
  };
  return { genome, inbreeding: round(F, 4), mutation };
}
