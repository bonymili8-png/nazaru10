import type { GameConfig } from "../config/index.js";
import { Rng } from "../rng.js";

/**
 * Yard events: the small things that go wrong in a real yard between starts: a pulled shoe,
 * heat in a leg, a horse off its feed, a horse cast in its box. Each is a choice between
 * spending something now (credits for a call-out, or rest) and accepting a risk. Nothing is
 * advised; an unanswered event settles on its own with the WAIT outcome, as the yard carries on.
 *
 * Deterministic: whether an owner gets an event in a window, when, and for which horse follow
 * from a seed, so the server can create events lazily (no cron) and idempotently.
 */
export const YARD_EVENTS = ["LOST_SHOE", "HEAT_IN_LEG", "OFF_FEED", "CAST_IN_BOX"] as const;
export type YardEventKind = (typeof YARD_EVENTS)[number];
export const YARD_CHOICES = ["ACT", "WAIT"] as const;
export type YardChoice = (typeof YARD_CHOICES)[number];

export interface YardHorse {
  id: string;
  /** When its last race finished (null if it has not raced). */
  lastRaceAt: Date | null;
}

export interface YardSpawn {
  kind: YardEventKind;
  horseId: string;
  at: Date;
}

/** Window number for a moment (windows are `windowHours` long from the epoch). */
export function yardWindow(at: Date, cfg: GameConfig): number {
  return Math.floor(at.getTime() / (cfg.yard.windowHours * 3_600_000));
}

/** The event (if any) an owner gets in a window: kind, horse and the moment it happens. */
export function yardEventFor(
  seed: string,
  window: number,
  horses: readonly YardHorse[],
  cfg: GameConfig,
): YardSpawn | null {
  const rng = new Rng(`yard:${seed}:${window}`);
  // Roll before looking at the horses, so buying or selling one never changes whether it happens.
  if (rng.next() >= cfg.yard.chancePerWindow || horses.length === 0) return null;
  const hours = cfg.yard.windowHours;
  const at = new Date((window * hours + rng.float(0, hours)) * 3_600_000);
  const horse = rng.pick(horses);
  const ev = cfg.yard.events;
  const raced = horse.lastRaceAt !== null;
  const justRaced =
    raced && at.getTime() - horse.lastRaceAt!.getTime() <= ev.HEAT_IN_LEG.afterRaceHours * 3_600_000;
  const kind = rng.weighted<YardEventKind>([
    // Shoes and legs matter for a horse in work; any horse can go off its feed or get cast.
    ["LOST_SHOE", raced ? ev.LOST_SHOE.weight : 0],
    ["HEAT_IN_LEG", justRaced ? ev.HEAT_IN_LEG.weight : 0],
    ["OFF_FEED", ev.OFF_FEED.weight],
    ["CAST_IN_BOX", ev.CAST_IN_BOX.weight],
  ]);
  return { kind, horseId: horse.id, at };
}

export interface YardEffect {
  /** Credits the owner pays (a call-out). */
  credits: number;
  /** Changes to the horse (fatigue/health points, trust points). */
  fatigue: number;
  health: number;
  bond: number;
  /** Shoes are worn until the farrier's next round. */
  shoesWorn: boolean;
  /** A fresh set of shoes. */
  freshShoes: boolean;
  /** Multiplier on the injury risk of the next start. */
  injuryFactor: number;
  /** A risk that did not come off (for the story). */
  bad: boolean;
}

/** What a choice does. `rng` decides the risky outcomes (seeded by the event on the server). */
export function yardOutcome(kind: YardEventKind, choice: YardChoice, rng: Rng, cfg: GameConfig): YardEffect {
  const e: YardEffect = {
    credits: 0,
    fatigue: 0,
    health: 0,
    bond: 0,
    shoesWorn: false,
    freshShoes: false,
    injuryFactor: 1,
    bad: false,
  };
  const ev = cfg.yard.events;
  switch (kind) {
    case "LOST_SHOE":
      if (choice === "ACT") {
        e.credits = ev.LOST_SHOE.actCost;
        e.freshShoes = true;
      } else {
        e.shoesWorn = true;
        e.bad = true;
      }
      break;
    case "HEAT_IN_LEG":
      if (choice === "ACT") e.fatigue = ev.HEAT_IN_LEG.actFatigue;
      else {
        e.injuryFactor = ev.HEAT_IN_LEG.waitInjuryFactor;
        e.bad = true;
      }
      break;
    case "OFF_FEED":
      if (choice === "ACT") e.credits = ev.OFF_FEED.actCost;
      else {
        e.health = -ev.OFF_FEED.waitHealth;
        e.bad = true;
      }
      break;
    case "CAST_IN_BOX":
      if (choice === "ACT") e.credits = ev.CAST_IN_BOX.actCost;
      else if (rng.next() < ev.CAST_IN_BOX.waitRisk) {
        e.health = -ev.CAST_IN_BOX.waitHealth;
        e.fatigue = ev.CAST_IN_BOX.waitFatigue;
        e.bad = true;
      } else e.bond = ev.CAST_IN_BOX.waitBond;
      break;
  }
  return e;
}

/** The call-out price of ACT for a kind (0 when acting costs time, not credits). */
export function yardActCost(kind: YardEventKind, cfg: GameConfig): number {
  const ev = cfg.yard.events[kind];
  return "actCost" in ev ? ev.actCost : 0;
}
