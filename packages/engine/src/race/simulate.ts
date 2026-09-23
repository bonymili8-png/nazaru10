import type { GameConfig, Strategy } from "../config/index.js";
import { fatigueModifier, formModifier, healthModifier } from "../horse/condition.js";
import type { Aptitudes, Attributes, Condition, Traits } from "../horse/types.js";
import { clamp, round } from "../math.js";
import { cyrb128, Rng } from "../rng.js";
import { isInTurn, turnRadius, type TrackDef, type Weather, type Wetness } from "./track.js";

export interface RaceJockey {
  id: string;
  name: string;
  /** 0–100 */
  skill: number;
}

export interface RaceEntrant {
  id: string;
  name: string;
  attributes: Attributes;
  traits: Traits;
  aptitudes: Aptitudes;
  raceIntelligence: number;
  condition: Condition;
  strategy: Strategy;
  jockey: RaceJockey;
  /** Carried weight (handicaps). Defaults to 55 kg. */
  weightKg?: number;
}

export interface RaceSetup {
  distance: number;
  track: TrackDef;
  weather: Weather;
  wetness: Wetness;
  /** 0–1, defaults to the track prestige. */
  prestige?: number;
}

export type RacePhase = "EARLY" | "MIDDLE" | "LATE" | "KICK";

export type RaceEventType =
  | "GOOD_BREAK"
  | "SLOW_START"
  | "LEAD_CHANGE"
  | "HALFWAY"
  | "FINAL_TURN"
  | "HOME_STRAIGHT"
  | "MOVE_UP"
  | "BLOCKED"
  | "KICK"
  | "TIRING"
  | "PHOTO_FINISH"
  | "FINISH";

export interface RaceEvent {
  /** Seconds since the gates opened. */
  t: number;
  type: RaceEventType;
  horseId?: string;
  /** Other horse ids relevant to the event (e.g. top three order). */
  others?: string[];
  value?: number;
}

export interface RaceResultRow {
  entrantId: string;
  gate: number;
  position: number;
  /** Finish time, seconds. */
  time: number;
  /** Lengths behind the winner. */
  lengthsBehind: number;
  deadHeat: boolean;
}

export interface RaceFrames {
  /** Seconds between frames. */
  interval: number;
  /** Entrant ids in gate order; frame rows follow this order. */
  ids: string[];
  /** frames[k][i] = [progressMetres, lane, speed m/s, energyRatio] at t = k·interval. */
  data: [number, number, number, number][][];
}

export interface RaceSimulationResult {
  results: RaceResultRow[];
  events: RaceEvent[];
  frames: RaceFrames;
  winningTime: number;
  /** Hash of the seed — safe to publish before the race (commit–reveal). */
  seedHash: string;
}

interface Runner {
  e: RaceEntrant;
  gate: number;
  topSpeed: number;
  accel: number;
  energyMax: number;
  energy: number;
  drainEff: number;
  kickDistance: number;
  kickBoost: number;
  cornerCap: number;
  reaction: number;
  slowStart: boolean;
  exhaustFloor: number;
  pulling: number;
  movePChance: number;
  paceNoise: number[];
  /** Planned effort for EARLY, MIDDLE, LATE (KICK = 1). */
  plan: [number, number, number];
  /** 0–1: how strongly the jockey re-plans pace from the energy actually left. */
  adapt: number;
  reserve: number;
  noiseSd: number;
  x: number;
  lane: number;
  targetLane: number;
  v: number;
  finishTime: number | null;
  blockedTicks: number;
  lastBlockedEvent: number;
  kicked: boolean;
  tired: boolean;
  lastMoveEvent: number;
}

const PHASE_INDEX: Record<Exclude<RacePhase, "KICK">, number> = { EARLY: 0, MIDDLE: 1, LATE: 2 };
const WETNESS_PENALTY = [0, 0.006, 0.03, 0.055] as const;

export const seedHash = (seed: string): string =>
  cyrb128(`commit:${seed}`)
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");

/** Deterministic per-pair synergy in [-1, 1]. */
export function jockeySynergy(horseId: string, jockeyId: string): number {
  const [a] = cyrb128(`syn:${horseId}:${jockeyId}`);
  return (a / 4294967295) * 2 - 1;
}

const environmentDrain = (setup: RaceSetup, cfg: GameConfig): number =>
  (1 + 0.04 * setup.wetness) * (1 + 0.05 * setup.track.elevation) * cfg.race.drainScale;

function prepareRunner(e: RaceEntrant, gate: number, setup: RaceSetup, rng: Rng, cfg: GameConfig): Runner {
  const a = e.attributes;
  const t = e.traits;
  const apt = e.aptitudes;
  const D = setup.distance;
  const prestige = setup.prestige ?? setup.track.prestige;
  const w = setup.wetness;
  const skill = clamp(e.jockey.skill, 0, 100);

  const fm = fatigueModifier(e.condition.fatigue);
  const hm = healthModifier(e.condition.health);
  const fo = formModifier(e.condition.form);
  const surf = 0.97 + 0.06 * (apt.surface[setup.track.surface] / 100);
  const goingMod =
    Math.min(1, 1 - WETNESS_PENALTY[w] * (1.3 - apt.wet * 0.012) + WETNESS_PENALTY[w] * a.strength * 0.002) *
    (1 - 0.008 * w);
  const weight = e.weightKg ?? 55;
  const weightMod = 1 - 0.0012 * (weight - 55) * (1.2 - a.strength * 0.004);

  // Distance fit: shorter than optimal costs top speed, longer than optimal is handled by energy.
  const rel = (D - apt.optimalDistance) / apt.optimalDistance;
  const rangeF = 1.3 - apt.distanceRange * 0.006;
  const speedFit = rel < 0 ? 1 - 0.04 * Math.min(1, -rel * rangeF * 1.2) : 1;
  const stretch = 1 + Math.max(0, rel) * (apt.distanceRange / 100) * 0.35;
  const effectiveOpt = apt.optimalDistance * stretch;

  const sigma = 0.008 + 0.014 * (1 - t.consistency / 100);
  const dayForm = 1 + clamp(rng.normal(0, sigma), -3 * sigma, 3 * sigma);
  const stress = 1 - 0.015 * prestige * (1 - t.stressResistance / 100);
  const synergy = 1 + 0.01 * jockeySynergy(e.id, e.jockey.id) * (skill / 100);

  // Real fields finish within a few lengths: every multiplicative deviation from the reference
  // horse is compressed by `performanceSpread` (monotonic → rankings and odds are preserved).
  const spread = cfg.race.performanceSpread;
  const cmp = (m: number, k = spread) => 1 + (m - 1) * k;
  const refSpeed = cfg.race.baseSpeed + 50 * cfg.race.speedPerPoint;
  const rawSpeed =
    (cfg.race.baseSpeed + a.speed * cfg.race.speedPerPoint) *
    fm *
    hm *
    fo *
    surf *
    goingMod *
    weightMod *
    speedFit *
    dayForm *
    stress *
    synergy;
  const topSpeed = refSpeed * cmp(rawSpeed / refSpeed);
  const accel = (1.6 + a.acceleration * 0.03) * (setup.weather === "COLD" ? 0.97 : 1);
  const refEnergy = cfg.race.energyScale * (D / cfg.race.refSpeed);
  const rawEnergy =
    cfg.race.energyScale * (effectiveOpt / cfg.race.refSpeed) * (0.7 + a.stamina * 0.006) * fm;
  const expectedEnergy = refEnergy * cmp(rawEnergy / refEnergy, cfg.race.energySpread);
  const energyMax = expectedEnergy * (1 + rng.normal(0, sigma * cfg.race.energySpread));
  // Jockeys know the horse and the going, but misjudge the plan by an amount that shrinks with skill.
  const judgement = 1 + rng.normal(0, 0.015 * (1.2 - skill / 100));

  const kickDistance = clamp(250 + a.finalKick * 2.5 + cfg.race.strategyKickBonus[e.strategy], 150, D * 0.35);

  let reaction = 0.15 + (1 - a.start / 100) * 0.45 + Math.abs(rng.normal(0, 0.06)) - skill * 0.001;
  const slowStart = rng.chance(
    0.04 * (1 - t.temperament / 200) * (1.2 - skill / 100) * (1.3 - t.courage / 200),
  );
  if (slowStart) reaction += rng.float(0.4, 1.1);

  const drainEff = cmp(1.25 - a.endurance * 0.005, cfg.race.energySpread);
  const plan = pacePlan(
    e.strategy,
    D,
    kickDistance,
    expectedEnergy * judgement,
    topSpeed,
    drainEff * environmentDrain(setup, cfg) * 1.01,
    cfg,
  );

  const positioning = (0.4 * skill + 0.3 * e.raceIntelligence + 0.3 * a.agility) / 100;
  const segments = 10;
  const paceSd = 0.012 * (1.2 - skill / 100) * spread;
  const paceNoise = Array.from({ length: segments }, () => rng.normal(0, paceSd));

  return {
    e,
    gate,
    topSpeed,
    accel,
    energyMax,
    energy: energyMax,
    drainEff,
    kickDistance,
    kickBoost: cmp(1 + a.finalKick * 0.0003),
    cornerCap: cmp(0.965 + 0.035 * ((0.7 * a.cornering + 0.3 * a.agility) / 100)) / cmp(0.9825),
    reaction: Math.max(0.05, reaction),
    slowStart,
    exhaustFloor: cfg.race.exhaustFloor + t.courage * 0.0005,
    pulling: (1 - t.temperament / 100) * (1.2 - (a.focus / 100) * 0.6) * 0.12,
    movePChance: (0.25 + 0.6 * positioning) * (setup.weather === "FOG" ? 0.85 : 1),
    paceNoise,
    plan,
    adapt: 0.3 + 0.5 * (skill / 100),
    reserve: cfg.race.strategyReserve[e.strategy],
    noiseSd: 0.004 * (1.2 - a.focus / 100) * spread,
    x: 0,
    // Starting stalls are narrower than a running lane.
    lane: gate * 0.6,
    targetLane: gate * 0.6,
    v: 0,
    finishTime: null,
    blockedTicks: 0,
    lastBlockedEvent: -100,
    kicked: false,
    tired: false,
    lastMoveEvent: -100,
  };
}

/**
 * Jockey pace plan: scale the strategy's pace shape so the energy needed for the whole race
 * (non-kick phases at the planned effort + the kick at full effort) matches the reserve.
 * Energy per metre at effort e is e^(γ−1)·drainEff/topSpeed.
 */
export function pacePlan(
  strategy: Strategy,
  distance: number,
  kickDistance: number,
  energy: number,
  topSpeed: number,
  drainEff: number,
  cfg: GameConfig,
): [number, number, number] {
  const g = cfg.race.drainExponent - 1;
  const shape = cfg.race.strategyShape[strategy];
  const cruiseEnd = Math.max(0, distance - kickDistance);
  const seg = (from: number, to: number) => Math.max(0, Math.min(to, cruiseEnd) - from);
  const lens = [
    seg(0, 0.25 * distance),
    seg(0.25 * distance, 0.75 * distance),
    seg(0.75 * distance, distance),
  ];
  const perMetre = drainEff / topSpeed;
  const budget = energy * (1 - cfg.race.strategyReserve[strategy]) - (distance - cruiseEnd) * perMetre;
  const denom = lens.reduce((sum, len, k) => sum + len * shape[k]! ** g, 0) * perMetre;
  const lambda = budget > 0 && denom > 0 ? (budget / denom) ** (1 / g) : 0.8;
  return shape.map((sh) => clamp(lambda * sh, 0.8, 1)) as [number, number, number];
}

function phaseOf(r: Runner, D: number): RacePhase {
  if (D - r.x <= r.kickDistance) return "KICK";
  const f = r.x / D;
  if (f < 0.25) return "EARLY";
  if (f < 0.75) return "MIDDLE";
  return "LATE";
}

interface Snapshot {
  x: number;
  lane: number;
  v: number;
  done: boolean;
}

/**
 * Simulate a race. Pure and deterministic for a given (entrants, setup, seed, cfg).
 * Entrant array order defines the starting gate (0 = rail).
 */
export function simulateRace(
  entrants: readonly RaceEntrant[],
  setup: RaceSetup,
  seed: string,
  cfg: GameConfig,
): RaceSimulationResult {
  if (entrants.length < 2) throw new RangeError("a race needs at least two entrants");
  if (new Set(entrants.map((e) => e.id)).size !== entrants.length)
    throw new RangeError("duplicate entrant id");

  const rc = cfg.race;
  const D = setup.distance;
  const dt = rc.tickSeconds;
  const L = rc.horseLength;
  const R = turnRadius(setup.track);
  const master = new Rng(seed);
  const runners = entrants.map((e, i) => prepareRunner(e, i, setup, master.fork(`horse:${i}:${e.id}`), cfg));
  const tickRng = master.fork("ticks");

  const windDrag = setup.weather === "WIND" ? 0.05 : 0.015;
  const heat = setup.weather === "HEAT";
  const envDrain = environmentDrain(setup, cfg);
  const homeStraightStart = D - setup.track.straightLength;

  const events: RaceEvent[] = [];
  const frames: RaceFrames = { interval: rc.frameEverySeconds, ids: runners.map((r) => r.e.id), data: [] };
  const ticksPerFrame = Math.max(1, Math.round(rc.frameEverySeconds / dt));
  const rankHistory: Map<string, number>[] = [];

  let t = 0;
  let tick = 0;
  let leader: string | null = null;
  let lastLeadChange = -100;
  let halfwayDone = false;
  let finalTurnDone = D <= setup.track.straightLength + setup.track.turnLength;
  let homeDone = D <= setup.track.straightLength + 100;

  const fastest = runners.reduce((b, r) => (r.reaction < b.reaction ? r : b));
  for (const r of runners) {
    if (r.slowStart) events.push({ t: round(r.reaction, 2), type: "SLOW_START", horseId: r.e.id });
  }
  events.push({ t: round(fastest.reaction, 2), type: "GOOD_BREAK", horseId: fastest.e.id });

  const recordFrame = () =>
    frames.data.push(
      runners.map((r) => [
        round(Math.min(r.x, D), 1),
        round(r.lane, 2),
        round(r.v, 2),
        round(Math.max(0, r.energy) / r.energyMax, 3),
      ]),
    );
  recordFrame();

  const maxTime = (D / 5) * 1.5;
  while (runners.some((r) => r.finishTime === null) && t < maxTime) {
    t += dt;
    tick++;
    const snap: Snapshot[] = runners.map((r) => ({
      x: r.x,
      lane: r.lane,
      v: r.v,
      done: r.finishTime !== null,
    }));
    const leaderX = Math.max(...snap.filter((s) => !s.done).map((s) => s.x));
    const order = runners
      .map((_, i) => i)
      .filter((i) => !snap[i]!.done)
      .sort((p, q) => snap[q]!.x - snap[p]!.x);
    const rankOf = new Map(order.map((i, k) => [i, k] as const));

    for (let i = 0; i < runners.length; i++) {
      const r = runners[i]!;
      const s = snap[i]!;
      if (s.done || t < r.reaction) continue;

      const phase = phaseOf(r, D);
      const seg = Math.min(9, Math.floor((r.x / D) * 10));
      let effort = phase === "KICK" ? 1 : r.plan[PHASE_INDEX[phase]]! + r.paceNoise[seg]!;
      if (phase === "MIDDLE" || phase === "LATE") {
        // Mid-race re-plan: the effort the remaining energy can sustain to the line (kick at full effort).
        const g = rc.drainExponent - 1;
        const perMetre = (r.drainEff * envDrain) / r.topSpeed;
        const kickLeft = Math.min(r.kickDistance, D - s.x);
        const cruiseLeft = Math.max(1, D - s.x - kickLeft);
        const budget = r.energy - r.reserve * r.energyMax - kickLeft * perMetre;
        const sustainable = budget > 0 ? (budget / (cruiseLeft * perMetre)) ** (1 / g) : 0.8;
        effort += r.adapt * (clamp(sustainable, 0.8, 1) - effort);
      }
      const rank = rankOf.get(i) ?? 0;
      const isLeader = rank === 0;

      if (
        (r.e.strategy === "FRONT_RUNNER" || r.e.strategy === "AGGRESSIVE") &&
        phase !== "KICK" &&
        phase !== "LATE"
      ) {
        if (!isLeader) effort += 0.02;
        else if (leaderX - (snap[order[1] ?? i]?.x ?? 0) > 3 * L) effort -= 0.015;
      }

      // Neighbours (from the snapshot, order-independent).
      let ahead: number | null = null;
      let aheadGap = Infinity;
      let nearRival = false;
      for (let j = 0; j < runners.length; j++) {
        if (j === i || snap[j]!.done) continue;
        const o = snap[j]!;
        const dx = o.x - s.x;
        const dl = Math.abs(o.lane - s.lane);
        if (dl < 0.9 && dx > 0 && dx < aheadGap) {
          aheadGap = dx;
          ahead = j;
        }
        if (Math.abs(dx) < L && dl < 2.5) nearRival = true;
      }

      let desired = r.topSpeed * effort;
      if (phase === "KICK") {
        // Fresh legs: energy beyond what the rest of the race needs at full effort becomes extra speed.
        const rem = Math.max(1, D - s.x);
        const perMetreAtFull = (r.drainEff * envDrain) / r.topSpeed;
        const sustainable = (Math.max(0, r.energy) / (rem * perMetreAtFull)) ** (1 / (rc.drainExponent - 1));
        desired =
          r.topSpeed *
          r.kickBoost *
          clamp(sustainable, 1, 1 + rc.freshLegsBoost) *
          (nearRival ? 1 + 0.008 * (r.e.traits.drive / 100) : 1);
      }

      const ratio = Math.max(0, r.energy) / r.energyMax;
      const capE = r.topSpeed * (r.exhaustFloor + (1 - r.exhaustFloor) * clamp(ratio / 0.12, 0, 1));
      desired = Math.min(desired, capE);

      const inTurn = isInTurn(setup.track, D, s.x);
      if (inTurn) desired *= r.cornerCap;

      // Traffic handling.
      let blocked = false;
      if (ahead !== null && aheadGap < L * 1.25 && desired > snap[ahead]!.v) {
        const free = (lane: number) =>
          lane >= 0 &&
          snap.every(
            (o, j) => j === i || o.done || Math.abs(o.lane - lane) >= 0.9 || Math.abs(o.x - s.x) >= L * 1.1,
          );
        if (r.targetLane === r.lane && tickRng.chance(r.movePChance)) {
          if (free(Math.round(r.lane) - 1)) r.targetLane = Math.round(r.lane) - 1;
          else if (free(Math.round(r.lane) + 1)) r.targetLane = Math.round(r.lane) + 1;
        }
        if (r.targetLane === r.lane) {
          blocked = true;
          desired = Math.min(desired, snap[ahead]!.v + 0.1);
        }
      } else if (r.targetLane === r.lane && r.lane > 0.01 && tickRng.chance(r.movePChance)) {
        // Drift toward the rail to save ground when the inside is clear.
        const inner = Math.max(0, Math.round(r.lane) - 1);
        const clear = snap.every(
          (o, j) => j === i || o.done || Math.abs(o.lane - inner) >= 0.9 || Math.abs(o.x - s.x) >= L * 1.05,
        );
        if (clear) r.targetLane = inner;
      }
      if (r.targetLane !== r.lane) {
        const step = 0.5;
        r.lane =
          Math.abs(r.targetLane - r.lane) <= step
            ? r.targetLane
            : r.lane + Math.sign(r.targetLane - r.lane) * step;
      }

      if (blocked) {
        r.blockedTicks++;
        if (r.blockedTicks === 4 && t - r.lastBlockedEvent > 15 && rank < 8) {
          events.push({ t: round(t, 2), type: "BLOCKED", horseId: r.e.id });
          r.lastBlockedEvent = t;
        }
      } else r.blockedTicks = 0;

      // Speed update.
      const prevV = r.v;
      if (desired > r.v) r.v = Math.min(desired, r.v + r.accel * dt);
      else r.v = Math.max(desired, r.v - 1.5 * dt);
      r.v *= 1 + tickRng.normal(0, r.noiseSd);
      r.v = Math.max(0, r.v);

      // Energy.
      const eff = r.v / r.topSpeed;
      let drain = dt * eff ** rc.drainExponent * r.drainEff * envDrain;
      if ((phase === "EARLY" || phase === "MIDDLE") && effort < 0.95)
        drain *= 1 + r.pulling * Math.min(1, (0.95 - effort) / 0.08);
      if ((phase === "EARLY" || phase === "MIDDLE") && rank <= 1 && nearRival) drain *= 1.06;
      if (ahead === null || aheadGap > 4) drain *= 1 + (rank === 0 ? windDrag : windDrag * 0.4);
      else if (aheadGap >= 1) drain *= 0.97;
      if (heat) drain *= 1.05 - r.e.attributes.endurance * 0.0004;
      r.energy -= drain;

      if (phase === "KICK" && !r.kicked) {
        r.kicked = true;
        if (rank < 5) events.push({ t: round(t, 2), type: "KICK", horseId: r.e.id });
      }
      if (r.energy <= 0 && !r.tired) {
        r.tired = true;
        if (rank < 4) events.push({ t: round(t, 2), type: "TIRING", horseId: r.e.id });
      }

      // Progress (outer lanes cover more ground on turns).
      const avgV = (prevV + r.v) / 2;
      let dx = avgV * dt;
      if (inTurn) dx /= 1 + (r.lane * rc.laneWidth) / R;
      if (s.x + dx >= D) {
        r.finishTime = t - dt + (dt * (D - s.x)) / dx;
        r.x = D;
      } else r.x = s.x + dx;
    }

    // Race-level markers & frames.
    const live = runners
      .map((r, i) => ({ r, i }))
      .sort((p, q) => {
        if (p.r.finishTime !== null && q.r.finishTime !== null) return p.r.finishTime - q.r.finishTime;
        if (p.r.finishTime !== null) return -1;
        if (q.r.finishTime !== null) return 1;
        return q.r.x - p.r.x;
      });
    const top = live[0]!.r;
    if (top.e.id !== leader && top.finishTime === null) {
      if (leader !== null && t - lastLeadChange >= 3 && t > 3) {
        events.push({ t: round(t, 2), type: "LEAD_CHANGE", horseId: top.e.id });
        lastLeadChange = t;
      }
      if (leader === null) lastLeadChange = t;
      leader = top.e.id;
    }
    const top3 = live.slice(0, 3).map((p) => p.r.e.id);
    if (!halfwayDone && top.x >= D / 2) {
      halfwayDone = true;
      events.push({ t: round(t, 2), type: "HALFWAY", horseId: top.e.id, others: top3 });
    }
    if (!finalTurnDone && top.x >= homeStraightStart - setup.track.turnLength) {
      finalTurnDone = true;
      events.push({ t: round(t, 2), type: "FINAL_TURN", horseId: top.e.id, others: top3 });
    }
    if (!homeDone && top.x >= homeStraightStart) {
      homeDone = true;
      events.push({ t: round(t, 2), type: "HOME_STRAIGHT", horseId: top.e.id, others: top3 });
    }

    if (tick % ticksPerFrame === 0) {
      recordFrame();
      const ranks = new Map(live.map((p, k) => [p.r.e.id, k] as const));
      rankHistory.push(ranks);
      const past = rankHistory[rankHistory.length - 6];
      if (past) {
        for (const p of live) {
          if (p.r.finishTime !== null) continue;
          const before = past.get(p.r.e.id)!;
          const now = ranks.get(p.r.e.id)!;
          const gained = before - now;
          if ((gained >= 3 || (gained >= 2 && now < 4)) && t - p.r.lastMoveEvent > 10) {
            events.push({ t: round(t, 2), type: "MOVE_UP", horseId: p.r.e.id, value: now + 1 });
            p.r.lastMoveEvent = t;
          }
        }
      }
    }
  }

  // Safety net: should never trigger with sane configs, but keep results total.
  for (const r of runners) {
    if (r.finishTime === null) r.finishTime = t + (D - r.x) / Math.max(1, r.v);
  }
  recordFrame();

  const sorted = [...runners].sort((p, q) => p.finishTime! - q.finishTime! || p.gate - q.gate);
  const winnerTime = round(sorted[0]!.finishTime!, 3);
  const lengthPerSec = D / winnerTime / L;
  const results: RaceResultRow[] = [];
  sorted.forEach((r, k) => {
    const time = round(r.finishTime!, 3);
    const prev = results[k - 1];
    const deadHeat = prev !== undefined && prev.time === time;
    if (deadHeat) prev.deadHeat = true;
    results.push({
      entrantId: r.e.id,
      gate: r.gate,
      position: deadHeat ? prev.position : k + 1,
      time,
      lengthsBehind: round((time - winnerTime) * lengthPerSec, 2),
      deadHeat,
    });
  });

  const second = results[1]!;
  if (second.time - winnerTime < 0.05) {
    events.push({
      t: round(winnerTime, 2),
      type: "PHOTO_FINISH",
      horseId: results[0]!.entrantId,
      others: [second.entrantId],
    });
  }
  events.push({
    t: round(winnerTime, 2),
    type: "FINISH",
    horseId: results[0]!.entrantId,
    others: [second.entrantId],
    value: second.lengthsBehind,
  });
  events.sort((p, q) => p.t - q.t);

  return { results, events, frames, winningTime: winnerTime, seedHash: seedHash(seed) };
}
