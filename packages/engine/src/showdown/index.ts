import type { GameConfig } from "../config/index.js";
import { generateGenome, initialAttributes } from "../horse/generate.js";
import { generateHorseName } from "../horse/names.js";
import { type Aptitudes, type Attributes, SURFACES, type Surface, type Traits } from "../horse/types.js";
import { Rng } from "../rng.js";

/**
 * Showdowns: exhibition tournaments between real people on tournament horses. Every horse is
 * bred to the same quality, so nobody's game progress or wallet matters; profiles differ (a
 * sprinter, a stayer, a mudlark), so reading your horse and choosing tactics still does.
 *
 * Modes: NORMAL — the horses tire from race to race and recover in real time, as in the game;
 * NO_FATIGUE — every race is run fresh.
 */
export const SHOWDOWN_MODES = ["NORMAL", "NO_FATIGUE"] as const;
export type ShowdownMode = (typeof SHOWDOWN_MODES)[number];

export interface ShowdownHorse {
  name: string;
  attributes: Attributes;
  traits: Traits;
  aptitudes: Aptitudes;
  raceIntelligence: number;
  injurySusceptibility: number;
}

/** A tournament horse, deterministic from its seed. */
export function showdownHorse(seed: string, cfg: GameConfig): ShowdownHorse {
  const rng = new Rng(`showdown-horse:${seed}`);
  const g = generateGenome(rng, { quality: cfg.showdown.quality }, cfg);
  return {
    name: generateHorseName(rng),
    attributes: initialAttributes(g, cfg.showdown.age, rng),
    traits: g.traits,
    aptitudes: g.aptitudes,
    raceIntelligence: g.hidden.raceIntelligence,
    injurySusceptibility: g.hidden.injurySusceptibility,
  };
}

/** The horse's favourite surface (for the card everyone sees). */
export function favouriteSurface(a: Aptitudes): Surface {
  return [...SURFACES].sort((x, y) => a.surface[y] - a.surface[x])[0]!;
}

/** Points for each player's finishing order among players (pace horses score nothing). */
export function showdownPoints(playerRank: number, cfg: GameConfig): number {
  return cfg.showdown.points[playerRank - 1] ?? 0;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A short invite code without look-alike characters (0/O, 1/I/L). */
export function showdownCode(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rng.next() * CODE_ALPHABET.length)];
  return s;
}

export const SHOWDOWN_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
