import {
  GEAR_ITEMS,
  type GameConfig,
  type GearItem,
  type Strategy,
  type TrainingType,
} from "../config/index.js";
import {
  type Aptitudes,
  type Attributes,
  SURFACES,
  type Surface,
  type TrainableAttribute,
  type Traits,
} from "../horse/types.js";
import { type DistanceProfile, distanceProfile } from "./index.js";

/** Reason codes the UI turns into sentences. */
export type TacticReason =
  "QUICK_EARLY" | "STRONG_FINISH" | "STAYS_WELL" | "BALANCED" | "KEEN" | "BRAVE" | "DRIVEN";

export type TraitNote =
  "INCONSISTENT" | "RELIABLE" | "BRAVE" | "FAINT_HEARTED" | "KEEN" | "CALM" | "DRIVEN" | "LAZY" | "STRESSED";

export interface AdvancedAdvice {
  profile: DistanceProfile;
  tactics: { strategy: Strategy; reasons: TacticReason[] }[];
  distance: { best: number; min: number; max: number };
  going: "SOFT" | "FIRM" | "ANY";
  surfaces: { surface: Surface; affinity: number }[];
  gear: { item: GearItem; helps: TrainableAttribute }[];
  training: { type: TrainingType; attribute: TrainableAttribute; headroom: number | null }[];
  traits: TraitNote[];
}

/** Attribute weights per trip, with a little of everything so any gap can matter. */
const NEEDS: Record<DistanceProfile, Record<TrainableAttribute, number>> = {
  SPRINTER: {
    speed: 1,
    acceleration: 0.9,
    start: 0.8,
    finalKick: 0.5,
    stamina: 0.2,
    endurance: 0.15,
    strength: 0.3,
    agility: 0.3,
    cornering: 0.3,
    focus: 0.3,
  },
  MILER: {
    speed: 0.9,
    finalKick: 0.8,
    stamina: 0.6,
    acceleration: 0.5,
    cornering: 0.4,
    endurance: 0.4,
    strength: 0.3,
    agility: 0.35,
    start: 0.35,
    focus: 0.35,
  },
  STAYER: {
    stamina: 1,
    endurance: 0.9,
    finalKick: 0.5,
    speed: 0.5,
    focus: 0.3,
    strength: 0.35,
    agility: 0.25,
    cornering: 0.3,
    acceleration: 0.2,
    start: 0.15,
  },
};

const avg = (...xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Expert advice for one horse from owner-visible data only: attributes, traits, aptitudes, and
 * the ceilings when (and only when) the owner has paid for diagnostics. Transparent rules — no race
 * simulation — so it explains the horse rather than predicting results.
 */
export function advancedAdvice(
  attributes: Attributes,
  traits: Traits,
  aptitudes: Aptitudes,
  ceilings: Attributes | null,
  cfg: GameConfig,
): AdvancedAdvice {
  const a = attributes;
  const profile = distanceProfile(aptitudes.optimalDistance);
  const early = avg(a.start, a.acceleration, a.speed);
  const late = avg(a.finalKick, a.stamina);
  const staying = avg(a.stamina, a.endurance);
  const keen = traits.temperament < 40;
  const brave = traits.courage > 65;
  const driven = traits.drive > 65;

  const score: Record<Strategy, number> = {
    FRONT_RUNNER: early + (brave ? 5 : 0) - (profile === "STAYER" ? 100 - staying : 0) * 0.3,
    PACE_SETTER: avg(early, staying) + (brave ? 3 : 0),
    MID_PACK: 100 - Math.abs(early - late) + (keen ? -4 : 0),
    CLOSER: late + a.agility * 0.15 - early * 0.15 + (keen ? -6 : 0),
    CONSERVATIVE: staying * 0.6 + (keen ? 18 : 0) + (profile === "STAYER" ? 6 : 0),
    AGGRESSIVE: early * 0.8 + (brave ? 8 : 0) + (driven ? 8 : 0) - (keen ? 6 : 0),
  };
  const reasonsFor = (s: Strategy): TacticReason[] => {
    const r: TacticReason[] = [];
    if ((s === "FRONT_RUNNER" || s === "PACE_SETTER" || s === "AGGRESSIVE") && early >= late)
      r.push("QUICK_EARLY");
    if ((s === "CLOSER" || s === "MID_PACK") && late >= early) r.push("STRONG_FINISH");
    if ((s === "PACE_SETTER" || s === "CONSERVATIVE") && staying >= 55) r.push("STAYS_WELL");
    if (s === "MID_PACK" && Math.abs(early - late) < 8) r.push("BALANCED");
    if (s === "CONSERVATIVE" && keen) r.push("KEEN");
    if ((s === "FRONT_RUNNER" || s === "AGGRESSIVE") && brave) r.push("BRAVE");
    if (s === "AGGRESSIVE" && driven) r.push("DRIVEN");
    return r.length ? r : ["BALANCED"];
  };
  const tactics = (Object.keys(score) as Strategy[])
    .sort((x, y) => score[y] - score[x])
    .slice(0, 2)
    .map((strategy) => ({ strategy, reasons: reasonsFor(strategy) }));

  // Distance window: wider for flexible horses.
  const spread = 0.06 + aptitudes.distanceRange * 0.0014;
  const round50 = (x: number) => Math.round(x / 50) * 50;
  const distance = {
    best: round50(aptitudes.optimalDistance),
    min: round50(aptitudes.optimalDistance * (1 - spread)),
    max: round50(aptitudes.optimalDistance * (1 + spread)),
  };
  const going = aptitudes.wet >= 65 ? "SOFT" : aptitudes.wet <= 35 ? "FIRM" : "ANY";
  const surfaces = [...SURFACES]
    .map((surface) => ({ surface, affinity: Math.round(aptitudes.surface[surface]) }))
    .sort((x, y) => y.affinity - x.affinity);

  // Gear: value of each item's trade for this horse's trip, weighted by how much room it has.
  const needs = NEEDS[profile];
  const gear = GEAR_ITEMS.map((item) => {
    let value = 0;
    let helps: TrainableAttribute = "speed";
    for (const [k, d] of Object.entries(cfg.equipment[item].mods) as [TrainableAttribute, number][]) {
      value += d * needs[k] * (d > 0 ? (110 - a[k]) / 100 : 1);
      if (d > 0) helps = k;
    }
    return { item, helps, value };
  })
    .filter((g) => g.value > 0)
    .sort((x, y) => y.value - x.value)
    .slice(0, 2)
    .map(({ item, helps }) => ({ item, helps }));

  // Training: biggest weighted gaps; with diagnostics, weigh by the room left under the ceiling.
  const training = (Object.keys(needs) as TrainableAttribute[])
    .map((k) => {
      const headroom = ceilings ? Math.max(0, Math.round(ceilings[k] - a[k])) : null;
      const gap = needs[k] * (headroom ?? 100 - a[k]);
      return { attribute: k, headroom, gap };
    })
    .filter((x) => x.gap > 0)
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 3)
    .map(({ attribute, headroom }) => ({ type: sessionFor(attribute, cfg), attribute, headroom }));

  const notes: TraitNote[] = [];
  if (traits.consistency < 40) notes.push("INCONSISTENT");
  else if (traits.consistency > 65) notes.push("RELIABLE");
  if (brave) notes.push("BRAVE");
  else if (traits.courage < 35) notes.push("FAINT_HEARTED");
  if (keen) notes.push("KEEN");
  else if (traits.temperament > 70) notes.push("CALM");
  if (driven) notes.push("DRIVEN");
  else if (traits.drive < 35) notes.push("LAZY");
  if (traits.stressResistance < 35) notes.push("STRESSED");

  return { profile, tactics, distance, going, surfaces, gear, training, traits: notes };
}

/** The session that trains an attribute hardest (the less tiring one on a tie). */
export function sessionFor(attribute: TrainableAttribute, cfg: GameConfig): TrainingType {
  let best: TrainingType = "SPEED";
  let top = -1;
  for (const [t, tc] of Object.entries(cfg.training.types) as [
    TrainingType,
    (typeof cfg.training.types)[TrainingType],
  ][]) {
    const w = tc.weights[attribute] ?? 0;
    const s = w - tc.baseFatigue / 1000;
    if (w > 0 && s > top) {
      top = s;
      best = t;
    }
  }
  return best;
}
