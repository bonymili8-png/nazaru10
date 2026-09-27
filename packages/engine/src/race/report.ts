import type { RaceEvent, RaceFrames } from "./simulate.js";

/** Why a run went the way it did: insight codes the UI turns into advice. */
export type ReportInsight =
  | "SLOW_START"
  | "GOOD_BREAK"
  | "BLOCKED"
  | "EMPTY_AT_FINISH"
  | "ENERGY_LEFT"
  | "FADED_LATE"
  | "STRONG_FINISH"
  | "RAN_TIRED"
  | "OFF_DISTANCE"
  | "LED_EARLY";

export interface RaceReport {
  /** Position when the horse passed 25 / 50 / 75 % of the distance, then the official result. */
  positions: number[];
  /** The horse's time for each quarter and the fastest time any runner did for it (seconds). */
  sectionals: { mine: number; best: number }[];
  topSpeed: number;
  /** Energy left (0–1) at 75 % of the distance and at the finish. */
  energyAt75: number;
  energyAtFinish: number;
  blockedCount: number;
  insights: ReportInsight[];
}

export interface ReportContext {
  distance: number;
  /** Fatigue carried into the race (from the entry snapshot). */
  fatigueAtStart: number;
  /** The horse's optimal distance (owner-visible aptitude). */
  optimalDistance: number;
  /** Official finishing position (frames are too coarse to separate close finishes). */
  position: number;
}

/** Linear interpolation of a runner's frame values at progress `d` (time and energy). */
function crossing(frames: RaceFrames, i: number, d: number): { t: number; energy: number } | null {
  const rows = frames.data;
  for (let k = 1; k < rows.length; k++) {
    const a = rows[k - 1]![i]!;
    const b = rows[k]![i]!;
    if (a[0] < d && b[0] >= d) {
      const f = b[0] === a[0] ? 1 : (d - a[0]) / (b[0] - a[0]);
      return { t: (k - 1 + f) * frames.interval, energy: a[3] + (b[3] - a[3]) * f };
    }
  }
  return null;
}

/** Progress of runner `i` at time `t` (interpolated). */
function progressAt(frames: RaceFrames, i: number, t: number): number {
  const k = t / frames.interval;
  const lo = Math.min(frames.data.length - 1, Math.floor(k));
  const hi = Math.min(frames.data.length - 1, lo + 1);
  const a = frames.data[lo]![i]![0];
  const b = frames.data[hi]![i]![0];
  return a + (b - a) * (k - lo);
}

/**
 * Post-race analysis for one runner, from the recorded frames and events only. It explains a
 * finished race (sectionals, positions, energy, trouble) and never predicts a future one.
 */
export function raceReport(
  frames: RaceFrames,
  events: readonly RaceEvent[],
  horseId: string,
  ctx: ReportContext,
): RaceReport {
  const i = frames.ids.indexOf(horseId);
  if (i < 0) throw new Error(`raceReport: ${horseId} did not run`);
  const D = ctx.distance;
  const marks = [0.25, 0.5, 0.75, 1].map((q) => q * D);
  const at = (r: number, d: number) => crossing(frames, r, d);

  const positions = marks.map((d, q) => {
    if (q === 3) return ctx.position;
    const me = at(i, d);
    if (!me) return frames.ids.length;
    let ahead = 0;
    for (let r = 0; r < frames.ids.length; r++) {
      if (r === i) continue;
      const other = at(r, d);
      // Ahead = passed this mark earlier (or is further on when we pass it).
      if (other ? other.t < me.t : progressAt(frames, r, me.t) > d) ahead++;
    }
    return ahead + 1;
  });

  const times = (r: number) => [0, ...marks.map((d) => at(r, d)?.t ?? Number.NaN)];
  const mine = times(i);
  const all = frames.ids.map((_, r) => times(r));
  const sectionals = [0, 1, 2, 3].map((q) => {
    const split = (ts: number[]) => ts[q + 1]! - ts[q]!;
    const best = Math.min(...all.map(split).filter((x) => Number.isFinite(x) && x > 0));
    return { mine: round2(split(mine)), best: round2(best) };
  });

  const topSpeed = Math.max(...frames.data.map((row) => row[i]![2]));
  const energyAt75 = at(i, 0.75 * D)?.energy ?? 0;
  const energyAtFinish = at(i, D)?.energy ?? frames.data.at(-1)![i]![3];
  const mineEvents = events.filter((e) => e.horseId === horseId);
  const blockedCount = mineEvents.filter((e) => e.type === "BLOCKED").length;

  const insights: ReportInsight[] = [];
  if (mineEvents.some((e) => e.type === "SLOW_START")) insights.push("SLOW_START");
  if (mineEvents.some((e) => e.type === "GOOD_BREAK")) insights.push("GOOD_BREAK");
  if (positions[0] === 1 && positions[3]! > 1) insights.push("LED_EARLY");
  if (blockedCount > 0) insights.push("BLOCKED");
  const lateChange = positions[3]! - positions[2]!;
  if (energyAtFinish < 0.05 && lateChange > 0) insights.push("EMPTY_AT_FINISH");
  else if (lateChange >= 2) insights.push("FADED_LATE");
  if (lateChange <= -2) insights.push("STRONG_FINISH");
  if (energyAtFinish > 0.25 && positions[3]! > 1) insights.push("ENERGY_LEFT");
  if (ctx.fatigueAtStart > 30) insights.push("RAN_TIRED");
  if (Math.abs(D - ctx.optimalDistance) / ctx.optimalDistance > 0.15) insights.push("OFF_DISTANCE");

  return {
    positions,
    sectionals,
    topSpeed: round2(topSpeed),
    energyAt75: round2(energyAt75),
    energyAtFinish: round2(energyAtFinish),
    blockedCount,
    insights,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
