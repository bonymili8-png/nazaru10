import { type GameConfig, TRAINING_TYPES, type TrainingType } from "../config/index.js";
import { clamp, round } from "../math.js";
import type { Rng } from "../rng.js";

export interface TrainerProfile {
  name: string;
  skill: number;
  /** Training type the trainer excels at (never RECOVERY), or null for an all-rounder. */
  specialty: TrainingType | null;
}

export interface TrainerEffect {
  gainMultiplier: number;
  injuryMultiplier: number;
}

const FIRST = [
  "Aidan",
  "Beatrice",
  "Callum",
  "Delphine",
  "Eamon",
  "Fiona",
  "Gideon",
  "Harriet",
  "Idris",
  "Juno",
  "Kieran",
  "Lucia",
  "Magnus",
  "Nadia",
  "Oren",
  "Phoebe",
  "Quentin",
  "Rosalind",
  "Silas",
  "Tamsin",
  "Ulric",
  "Vera",
  "Wilhelm",
  "Xenia",
  "Yusuf",
  "Zara",
];
const LAST = [
  "Ashdown",
  "Blackwood",
  "Carrington",
  "Dunmore",
  "Ellery",
  "Fairbairn",
  "Galloway",
  "Hartigan",
  "Ingram",
  "Kilbride",
  "Lockhart",
  "Marlowe",
  "Northcott",
  "O'Rourke",
  "Pembroke",
  "Quill",
  "Radcliffe",
  "Sinclair",
  "Thornton",
  "Vaughan",
  "Whitlock",
  "Yardley",
];

const SPECIALTIES = TRAINING_TYPES.filter((t) => t !== "RECOVERY");

/** A new trainer for the hiring pool: most are journeymen, a few are masters. */
export function generateTrainer(rng: Rng, cfg: GameConfig): TrainerProfile {
  const s = cfg.staff;
  const skill = Math.round(s.minSkill + (s.maxSkill - s.minSkill) * rng.next() ** 1.6);
  return {
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    skill,
    specialty: rng.chance(0.6) ? rng.pick(SPECIALTIES) : null,
  };
}

export function trainerSalary(skill: number, cfg: GameConfig): number {
  const over = Math.max(0, skill - cfg.staff.minSkill);
  return Math.round((cfg.staff.salaryBase + cfg.staff.salaryPerSkill2 * over * over) / 10) * 10;
}

export function trainerEffect(
  trainer: Pick<TrainerProfile, "skill" | "specialty">,
  type: TrainingType,
  cfg: GameConfig,
): TrainerEffect {
  const s = cfg.staff;
  const over = clamp(trainer.skill - s.minSkill, 0, s.maxSkill - s.minSkill);
  const special = trainer.specialty !== null && trainer.specialty === type ? s.specialtyBonus : 0;
  return {
    gainMultiplier: round(1 + over * s.gainPerSkill + special, 3),
    injuryMultiplier: round(clamp(1 - over * s.injuryReductionPerSkill, 0.5, 1), 3),
  };
}

/** The employed trainer who helps most with this session type (by gain, then injury). */
export function bestTrainerFor<T extends Pick<TrainerProfile, "skill" | "specialty">>(
  trainers: T[],
  type: TrainingType,
  cfg: GameConfig,
): { trainer: T; effect: TrainerEffect } | null {
  let best: { trainer: T; effect: TrainerEffect } | null = null;
  for (const trainer of trainers) {
    const effect = trainerEffect(trainer, type, cfg);
    if (
      !best ||
      effect.gainMultiplier > best.effect.gainMultiplier ||
      (effect.gainMultiplier === best.effect.gainMultiplier &&
        effect.injuryMultiplier < best.effect.injuryMultiplier)
    )
      best = { trainer, effect };
  }
  return best;
}

export function maxTrainers(stableLevel: number, cfg: GameConfig): number {
  const list = cfg.staff.maxTrainers;
  return list[clamp(stableLevel, 1, list.length) - 1] ?? 0;
}

export interface JockeyProfile {
  name: string;
  skill: number;
}

const JOCKEY_FIRST = [
  "Ailbhe",
  "Bruno",
  "Caoimhe",
  "Dario",
  "Emeka",
  "Farah",
  "Gianni",
  "Hana",
  "Ivo",
  "Jolene",
  "Kofi",
  "Luis",
  "Mairead",
  "Nico",
  "Oisin",
  "Pia",
  "Rafa",
  "Saoirse",
  "Tadhg",
  "Yara",
];
const JOCKEY_LAST = [
  "Arrowsmith",
  "Brannigan",
  "Castellano",
  "Doyle",
  "Esposito",
  "Flanagan",
  "Guerrero",
  "Hayes",
  "Kinsella",
  "Moreno",
  "Nakamura",
  "O'Shea",
  "Prendergast",
  "Rourke",
  "Santana",
  "Treacy",
];

/** A freelance jockey for hire: skill skews toward the lower end of the band. */
export function generateJockey(rng: Rng, cfg: GameConfig): JockeyProfile {
  const j = cfg.staff.jockeys;
  return {
    name: `${rng.pick(JOCKEY_FIRST)} ${rng.pick(JOCKEY_LAST)}`,
    skill: Math.round(j.minSkill + (j.maxSkill - j.minSkill) * rng.next() ** 1.4),
  };
}

export function jockeySalary(skill: number, cfg: GameConfig): number {
  const j = cfg.staff.jockeys;
  const over = Math.max(0, skill - j.minSkill);
  return Math.round((j.salaryBase + j.salaryPerSkill2 * over * over) / 10) * 10;
}

export function maxJockeys(stableLevel: number, cfg: GameConfig): number {
  const list = cfg.staff.jockeys.maxJockeys;
  return list[clamp(stableLevel, 1, list.length) - 1] ?? 0;
}
