import type { GameConfig, RaceClass } from "../config/index.js";
import { generateGenome, initialAttributes } from "../horse/generate.js";
import { SURFACES, type Surface } from "../horse/types.js";
import { Rng } from "../rng.js";
import { type RaceEntrant, simulateRace } from "../race/simulate.js";
import type { TrackDef } from "../race/track.js";

/**
 * Morning work on the clock: the horse works a set distance upsides the yard's lead horse for a
 * class (a fixed, known yardstick, like a trainer's old handicapper), and the owner gets the time
 * and the margin. It is information to judge for yourself, not advice: nothing says which class
 * or trip to run in. It costs some fatigue and runs on a cooldown.
 */
export const GALLOP_SURFACES = SURFACES;

export interface GallopResult {
  /** The horse's time, seconds. */
  time: number;
  leadTime: number;
  /** Lengths: positive = beat the lead horse by, negative = finished behind by. */
  margin: number;
}

/** The yard's all-weather gallop: flat, one long bend, no crowd. */
export function gallopTrack(surface: Surface, distance: number): TrackDef {
  return {
    code: "GALLOPS",
    name: "The gallops",
    archetype: "Gallops",
    surface,
    turnLength: 300,
    straightLength: 900,
    elevation: 0,
    goingSensitivity: 0,
    prestige: 0,
    rainBias: 0,
    distances: [distance],
  };
}

/**
 * The lead horse for a class: always the same horse (seeded by class), a typical house runner of
 * that class, fresh, equally at home on every surface and suited to the trip it works over.
 */
export function gallopLead(cls: RaceClass, distance: number, cfg: GameConfig): RaceEntrant {
  const cc = cfg.race.classes[cls];
  const rng = new Rng(`gallop-lead:${cls}`);
  const g = generateGenome(rng, { quality: (cc.houseQuality[0] + cc.houseQuality[1]) / 2 }, cfg);
  const surfaceAvg = SURFACES.reduce((a, s) => a + g.aptitudes.surface[s], 0) / SURFACES.length;
  return {
    id: "lead",
    name: "Lead horse",
    attributes: initialAttributes(g, (cc.houseAge[0] + cc.houseAge[1]) / 2, rng),
    traits: g.traits,
    aptitudes: {
      ...g.aptitudes,
      surface: { TURF: surfaceAvg, DIRT: surfaceAvg, SYNTHETIC: surfaceAvg },
      optimalDistance: distance,
    },
    raceIntelligence: g.hidden.raceIntelligence,
    condition: { fatigue: 0, health: 100, form: 0 },
    strategy: "MID_PACK",
    jockey: { id: "work-rider-lead", name: "Work rider", skill: cfg.gallop.riderSkill },
  };
}

/** Run the work. `horse` is the owner's horse as it is now (condition, trust and all). */
export function runGallop(
  horse: RaceEntrant,
  cls: RaceClass,
  surface: Surface,
  distance: number,
  seed: string,
  cfg: GameConfig,
): GallopResult {
  const me: RaceEntrant = {
    ...horse,
    id: "horse",
    strategy: "MID_PACK",
    jockey: { id: "work-rider", name: "Work rider", skill: cfg.gallop.riderSkill },
  };
  const res = simulateRace(
    [me, gallopLead(cls, distance, cfg)],
    { distance, track: gallopTrack(surface, distance), weather: "CLOUDY", wetness: 0, prestige: 0 },
    seed,
    cfg,
  );
  const mine = res.results.find((r) => r.entrantId === "horse")!;
  const lead = res.results.find((r) => r.entrantId === "lead")!;
  const margin = mine.position < lead.position ? lead.lengthsBehind : -mine.lengthsBehind;
  return { time: mine.time, leadTime: lead.time, margin: Math.round(margin * 10) / 10 };
}
