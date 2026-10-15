import type { GameConfig } from "../config/index.js";

/**
 * Tipster league: players predict the first three of upcoming races for points, never stakes.
 * Each runner carries a "tip value" — the points for naming it as the winner — that grows the
 * less likely it looks on strength alone, so finding the outsider that wins pays most. The value
 * is a public, simple yardstick; reading form (trip, going, fitness, tactics) is the tipster's edge.
 */

/** Points for naming each runner the winner, from the field's strength (higher = outsider). */
export function tipValues(field: { id: string; strength: number }[], cfg: GameConfig): Map<string, number> {
  const t = cfg.tipster;
  if (field.length === 0) return new Map();
  const max = Math.max(...field.map((f) => f.strength));
  const w = field.map((f) => Math.exp((f.strength - max) * t.strengthSpread));
  const sum = w.reduce((a, b) => a + b, 0);
  return new Map(
    field.map((f, i) => {
      const p = w[i]! / sum;
      return [f.id, Math.min(t.maxValue, Math.max(t.minValue, Math.round(t.valueScale / p)))] as const;
    }),
  );
}

export interface TipScore {
  points: number;
  /** Points per pick slot (1st, 2nd, 3rd), and the all-three-in-order bonus. */
  slots: number[];
  tricast: number;
}

/**
 * Score a tip: the 1st pick winning earns its tip value; a 2nd/3rd pick in its exact place earns
 * `placeExact`; any other pick finishing in the first three earns `placeAny`; all three in the
 * exact order add `tricastBonus`. A pick that did not run scores nothing.
 */
export function scoreTip(
  picks: string[],
  positions: Map<string, number>,
  values: Map<string, number>,
  cfg: GameConfig,
): TipScore {
  const t = cfg.tipster;
  const slots = picks.map((id, i) => {
    const pos = positions.get(id);
    if (pos === undefined) return 0;
    if (i === 0 && pos === 1) return values.get(id) ?? t.minValue;
    if (i > 0 && pos === i + 1) return t.placeExact;
    return pos <= 3 ? t.placeAny : 0;
  });
  const tricast =
    picks.length === 3 && picks.every((id, i) => positions.get(id) === i + 1) ? t.tricastBonus : 0;
  return { points: slots.reduce((a, b) => a + b, 0) + tricast, slots, tricast };
}

/** Start (Monday 00:00 UTC) of the tipster week containing `at`. */
export function tipsterWeek(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * 86_400_000);
}
