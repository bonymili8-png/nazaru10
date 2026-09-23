import type { HorseStatus } from "./types.js";

const TRANSITIONS: Record<HorseStatus, readonly HorseStatus[]> = {
  IDLE: ["TRAINING", "ENTERED", "INJURED", "LISTED", "BREEDING", "RETIRED"],
  TRAINING: ["IDLE", "INJURED"],
  ENTERED: ["IDLE", "RACING"],
  RACING: ["IDLE", "INJURED"],
  INJURED: ["IDLE", "RETIRED"],
  LISTED: ["IDLE"],
  /** Mare carrying a foal (gestation). */
  BREEDING: ["IDLE"],
  RETIRED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: HorseStatus,
    readonly to: HorseStatus,
  ) {
    super(`Illegal horse status transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export const canTransition = (from: HorseStatus, to: HorseStatus): boolean => TRANSITIONS[from].includes(to);

export function assertTransition(from: HorseStatus, to: HorseStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export const allowedTransitions = (from: HorseStatus): readonly HorseStatus[] => TRANSITIONS[from];
