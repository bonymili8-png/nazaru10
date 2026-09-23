import type { Surface } from "../horse/types.js";
import type { Rng } from "../rng.js";

export interface TrackDef {
  code: string;
  name: string;
  archetype: string;
  surface: Surface;
  /** Length of each of the two turns (semicircles), metres. */
  turnLength: number;
  /** Length of each straight (home straight = back straight), metres. */
  straightLength: number;
  /** 0–1: extra energy cost from gradients. */
  elevation: number;
  /** 0–1: how strongly rain changes the going. */
  goingSensitivity: number;
  /** 0–1: crowd/prestige pressure. */
  prestige: number;
  /** Relative multiplier on rainy weather frequency. */
  rainBias: number;
  distances: number[];
}

export const TRACKS: readonly TrackDef[] = [
  {
    code: "URBAN",
    name: "Riverside Urban Park",
    archetype: "Urban Track",
    surface: "DIRT",
    turnLength: 380,
    straightLength: 300,
    elevation: 0.1,
    goingSensitivity: 0.7,
    prestige: 0.2,
    rainBias: 1,
    distances: [1000, 1200, 1400, 1600],
  },
  {
    code: "DESERT",
    name: "Golden Dunes Oasis",
    archetype: "Desert Track",
    surface: "DIRT",
    turnLength: 400,
    straightLength: 400,
    elevation: 0.05,
    goingSensitivity: 0.4,
    prestige: 0.5,
    rainBias: 0.2,
    distances: [1200, 1400, 1600, 1800, 2000],
  },
  {
    code: "EUROTURF",
    name: "Royal Meadow Downs",
    archetype: "European Turf",
    surface: "TURF",
    turnLength: 450,
    straightLength: 550,
    elevation: 0.3,
    goingSensitivity: 1,
    prestige: 0.7,
    rainBias: 1.4,
    distances: [1400, 1600, 2000, 2400],
  },
  {
    code: "AMDIRT",
    name: "Bluegrass Oval",
    archetype: "American Dirt",
    surface: "DIRT",
    turnLength: 400,
    straightLength: 405,
    elevation: 0,
    goingSensitivity: 0.8,
    prestige: 0.6,
    rainBias: 1,
    distances: [1100, 1200, 1700, 2000],
  },
  {
    code: "MOUNTAIN",
    name: "Highpass Ridge",
    archetype: "Mountain Track",
    surface: "TURF",
    turnLength: 320,
    straightLength: 280,
    elevation: 0.8,
    goingSensitivity: 0.8,
    prestige: 0.3,
    rainBias: 1.2,
    distances: [1200, 1600, 2000],
  },
  {
    code: "COASTAL",
    name: "Stormhaven Coast",
    archetype: "Wet Track",
    surface: "TURF",
    turnLength: 420,
    straightLength: 380,
    elevation: 0.15,
    goingSensitivity: 1,
    prestige: 0.4,
    rainBias: 2.2,
    distances: [1400, 1800, 2200],
  },
  {
    code: "NIGHT",
    name: "Neon Lights Raceway",
    archetype: "Night Track",
    surface: "SYNTHETIC",
    turnLength: 380,
    straightLength: 370,
    elevation: 0,
    goingSensitivity: 0.1,
    prestige: 0.45,
    rainBias: 1,
    distances: [1000, 1200, 1600, 1800],
  },
  {
    code: "STADIUM",
    name: "Grand Crown Stadium",
    archetype: "Elite Stadium",
    surface: "TURF",
    turnLength: 480,
    straightLength: 620,
    elevation: 0.2,
    goingSensitivity: 0.9,
    prestige: 1,
    rainBias: 1,
    distances: [1600, 2000, 2400, 3200],
  },
  {
    code: "COUNTRY",
    name: "Willowbrook Fields",
    archetype: "Country Track",
    surface: "TURF",
    turnLength: 350,
    straightLength: 300,
    elevation: 0.35,
    goingSensitivity: 0.9,
    prestige: 0.15,
    rainBias: 1.2,
    distances: [1000, 1400, 1800],
  },
  {
    code: "LAB",
    name: "Aurora Proving Grounds",
    archetype: "Experimental Track",
    surface: "SYNTHETIC",
    turnLength: 300,
    straightLength: 450,
    elevation: 0.1,
    goingSensitivity: 0.1,
    prestige: 0.35,
    rainBias: 1,
    distances: [1200, 1600, 2000],
  },
];

export function trackByCode(code: string): TrackDef {
  const t = TRACKS.find((x) => x.code === code);
  if (!t) throw new Error(`Unknown track ${code}`);
  return t;
}

export const WEATHERS = ["SUNNY", "CLOUDY", "RAIN", "HEAVY_RAIN", "WIND", "FOG", "HEAT", "COLD"] as const;
export type Weather = (typeof WEATHERS)[number];

const WEATHER_WEIGHTS: Record<Weather, number> = {
  SUNNY: 30,
  CLOUDY: 25,
  RAIN: 12,
  HEAVY_RAIN: 5,
  WIND: 10,
  FOG: 5,
  HEAT: 8,
  COLD: 5,
};

export function rollWeather(track: TrackDef, rng: Rng): Weather {
  return rng.weighted(
    WEATHERS.map(
      (w) => [w, WEATHER_WEIGHTS[w] * (w === "RAIN" || w === "HEAVY_RAIN" ? track.rainBias : 1)] as const,
    ),
  );
}

/** Wetness 0 (firm/fast) … 3 (heavy/sloppy). */
export type Wetness = 0 | 1 | 2 | 3;

export function rollWetness(track: TrackDef, weather: Weather, rng: Rng): Wetness {
  const base =
    weather === "HEAVY_RAIN"
      ? 3
      : weather === "RAIN"
        ? 2
        : weather === "SUNNY" || weather === "HEAT"
          ? 0
          : rng.chance(0.4)
            ? 1
            : 0;
  const scaled = Math.round(base * track.goingSensitivity + (rng.next() - 0.5) * 0.6);
  return Math.max(0, Math.min(3, scaled)) as Wetness;
}

const GOING_LABELS: Record<Surface, readonly [string, string, string, string]> = {
  TURF: ["FIRM", "GOOD", "SOFT", "HEAVY"],
  DIRT: ["FAST", "GOOD", "MUDDY", "SLOPPY"],
  SYNTHETIC: ["STANDARD", "STANDARD", "STANDARD_TO_SLOW", "SLOW"],
};

export const goingLabel = (surface: Surface, wetness: Wetness): string => GOING_LABELS[surface][wetness];

/** Position on the oval for a given race progress; the finish line is at the end of the home straight. */
export function isInTurn(track: TrackDef, distance: number, progress: number): boolean {
  const c = 2 * track.turnLength + 2 * track.straightLength;
  const startOffset = (((c - (distance % c)) % c) + c) % c;
  const p = (startOffset + progress) % c;
  const t = track.turnLength;
  const s = track.straightLength;
  return p < t || (p >= t + s && p < 2 * t + s);
}

export const turnRadius = (track: TrackDef): number => track.turnLength / Math.PI;
