import type { GameConfig } from "../config/index.js";
import type { Traits } from "../horse/types.js";
import { clamp } from "../math.js";

/**
 * Daily care: what a groom, a farrier and the yard do between starts. Free (the owner's time,
 * never credits or gems), each action on its own cooldown, with small, realistic effects:
 * walking and cold hosing help a tired horse recover, a massage before a start lowers the injury
 * risk, fresh shoes avoid the risk of racing on worn ones, and steady handling builds the
 * horse's trust (bond), which makes it steadier on race day.
 */
export const CARE_ACTIONS = ["GROOM", "HAND_WALK", "COLD_HOSE", "MASSAGE", "FARRIER"] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];

export interface CareState {
  /** Trust 0–100 as stored, decaying from `bondAt`. */
  bond: number;
  bondAt: Date;
  /** When each action was last done. */
  last: Partial<Record<CareAction, string>>;
  /** Starts run since the horse was last shod. */
  shoeStarts: number;
  /** A massage is waiting to help the next start. */
  massaged: boolean;
  /** When the horse's last race finished (null if it has not raced). */
  lastRaceAt: Date | null;
  /** The last race was already cold-hosed. */
  hosedLastRace: boolean;
}

/** Bond now: it fades slowly without care (horses remember, but not for ever). */
export function bondNow(bond: number, bondAt: Date, now: Date, cfg: GameConfig): number {
  const days = Math.max(0, (now.getTime() - bondAt.getTime()) / 86_400_000);
  return clamp(bond - cfg.care.bondDecayPerDay * days, 0, cfg.care.bondMax);
}

export type CareBlock = "COOLDOWN" | "NO_RECENT_RACE" | "ALREADY_HOSED" | "SHOES_FRESH";

/** Why an action cannot be done now (null when it can), and when it becomes available. */
export function careAvailability(
  action: CareAction,
  s: CareState,
  now: Date,
  cfg: GameConfig,
): { block: CareBlock | null; availableAt: Date | null } {
  const a = cfg.care.actions[action];
  const last = s.last[action] ? new Date(s.last[action]!) : null;
  if (action === "COLD_HOSE") {
    if (!s.lastRaceAt || now.getTime() - s.lastRaceAt.getTime() > a.windowHours! * 3_600_000)
      return { block: "NO_RECENT_RACE", availableAt: null };
    if (s.hosedLastRace) return { block: "ALREADY_HOSED", availableAt: null };
    return { block: null, availableAt: null };
  }
  if (action === "FARRIER" && s.shoeStarts === 0) return { block: "SHOES_FRESH", availableAt: null };
  if (last) {
    const at = new Date(last.getTime() + a.cooldownHours * 3_600_000);
    if (at > now) return { block: "COOLDOWN", availableAt: at };
  }
  return { block: null, availableAt: null };
}

/** Race-day traits with the bond folded in: a trusting horse is steadier and calmer. */
export function traitsWithBond(traits: Traits, bond: number, cfg: GameConfig): Traits {
  return {
    ...traits,
    consistency: clamp(traits.consistency + bond * cfg.care.bondConsistencyFactor, 0, 100),
    temperament: clamp(traits.temperament + bond * cfg.care.bondTemperamentFactor, 0, 100),
  };
}

/** Injury-risk multiplier for a start from care: a massage lowers it, worn shoes raise it. */
export function careInjuryFactor(s: Pick<CareState, "massaged" | "shoeStarts">, cfg: GameConfig): number {
  let f = 1;
  if (s.massaged) f *= cfg.care.actions.MASSAGE.injuryFactor!;
  if (s.shoeStarts >= cfg.care.shoeStarts) f *= cfg.care.wornShoeInjuryFactor;
  return f;
}

/** Lads a yard of `horses` needs to have every horse looked after (at least one). */
export function ladsNeeded(horses: number, cfg: GameConfig): number {
  const l = cfg.care.lads;
  return Math.min(l.maxLads, Math.max(1, Math.ceil(horses / l.horsesPerLad)));
}

/** Horses `lads` look after: `horsesPerLad` each, and the full team the whole yard. */
export function ladsCover(lads: number, cfg: GameConfig): number {
  const l = cfg.care.lads;
  return lads >= l.maxLads ? Number.POSITIVE_INFINITY : lads * l.horsesPerLad;
}

/**
 * The jobs a lad does on the round from what is ready: everything, except that the farrier
 * is only called for worn shoes (not after every start).
 */
export function ladJobs(
  ready: readonly CareAction[],
  s: Pick<CareState, "shoeStarts">,
  cfg: GameConfig,
): CareAction[] {
  return ready.filter((a) => a !== "FARRIER" || s.shoeStarts >= cfg.care.shoeStarts);
}
