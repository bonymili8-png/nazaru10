/**
 * Class fairness probe: how often does a trained player horse, clearly above the house field on
 * the displayed ability rating, win or place? Compares house fields picked for the race distance
 * (as the API does) against random ones, and a player horse that suits the trip against one
 * that does not.   pnpm tsx scripts/probe-class-fairness.ts [races=4000] [class=CLASS_5]
 */
import {
  abilityRating,
  defaultConfig as cfg,
  generateGenome,
  initialAttributes,
  Rng,
  simulateRace,
  TRACKS,
  rollWeather,
  rollWetness,
  type RaceClass,
  type RaceEntrant,
  type Attributes,
} from "../src/index.js";

const N = Number(process.argv[2] ?? 4000);
const CLS = (process.argv[3] ?? "CLASS_5") as RaceClass;
const cc = cfg.race.classes[CLS];

function house(rng: Rng, distance: number, id: string, matchDistance: boolean): RaceEntrant {
  // The API draws from a pool of ~3x the field and takes those closest to the trip.
  const pool = Array.from({ length: matchDistance ? 3 : 1 }, () => {
    const g = generateGenome(rng, { quality: rng.float(...cc.houseQuality) }, cfg);
    return g;
  }).sort(
    (a, b) =>
      Math.abs(a.aptitudes.optimalDistance - distance) - Math.abs(b.aptitudes.optimalDistance - distance),
  );
  const g = pool[0]!;
  return {
    id,
    name: id,
    attributes: initialAttributes(g, rng.float(...cc.houseAge), rng),
    traits: g.traits,
    aptitudes: g.aptitudes,
    raceIntelligence: g.hidden.raceIntelligence,
    condition: { fatigue: rng.float(0, 20), health: 100, form: 0 },
    strategy: rng.pick([
      "FRONT_RUNNER",
      "PACE_SETTER",
      "MID_PACK",
      "MID_PACK",
      "CLOSER",
      "CONSERVATIVE",
      "AGGRESSIVE",
    ] as const),
    jockey: { id: `j${id}`, name: "J", skill: rng.float(...cc.houseJockeySkill) },
  };
}

/** A player horse of the class band, trained until its rating is `edge` above the house mean. */
function player(rng: Rng, distance: number, target: number, fitsTrip: boolean, fatigue: number): RaceEntrant {
  const g = generateGenome(rng, { quality: (cc.houseQuality[0] + cc.houseQuality[1]) / 2 }, cfg);
  if (fitsTrip) g.aptitudes = { ...g.aptitudes, optimalDistance: distance };
  let a: Attributes = initialAttributes(g, 3, rng);
  // Spread training over every attribute until the displayed rating reaches the target.
  for (let i = 0; i < 400 && abilityRating(a, g.traits) < target; i++) {
    a = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.min(100, v + 0.25)])) as Attributes;
  }
  return {
    id: "me",
    name: "me",
    attributes: a,
    traits: g.traits,
    aptitudes: g.aptitudes,
    raceIntelligence: g.hidden.raceIntelligence,
    condition: { fatigue, health: 100, form: 0 },
    strategy: "MID_PACK",
    jockey: { id: "jme", name: "J", skill: rng.float(...cc.houseJockeySkill) },
  };
}

function run(label: string, opts: { match: boolean; fits: boolean; edge: number; fatigue: number }) {
  const rng = new Rng(`fair:${label}`);
  let win = 0,
    top3 = 0,
    houseMean = 0,
    mine = 0;
  for (let i = 0; i < N; i++) {
    const track = rng.pick(TRACKS);
    const distance = rng.pick(track.distances);
    const field = Array.from({ length: 7 }, (_, k) => house(rng, distance, `h${k}`, opts.match));
    const hm = field.reduce((s, e) => s + abilityRating(e.attributes, e.traits), 0) / field.length;
    const me = player(rng, distance, hm + opts.edge, opts.fits, opts.fatigue);
    houseMean += hm;
    mine += abilityRating(me.attributes, me.traits);
    const weather = rollWeather(track, rng);
    const res = simulateRace(
      [...field, me],
      { distance, track, weather, wetness: rollWetness(track, weather, rng) },
      `${i}:${label}`,
      cfg,
    );
    const pos = res.results.find((r) => r.entrantId === "me")!.position;
    if (pos === 1) win++;
    if (pos <= 3) top3++;
  }
  const pct = (x: number) => `${((x / N) * 100).toFixed(1)}%`.padStart(6);
  console.log(
    `${label.padEnd(58)} rating ${(mine / N).toFixed(1)} vs house ${(houseMean / N).toFixed(1)} | win ${pct(win)} | top-3 ${pct(top3)}`,
  );
}

console.log(
  `${CLS}, 8 runners (1 player + 7 house), ${N} races each; a random runner wins 12.5%, top-3 37.5%`,
);
if (process.env.CURVE) {
  for (const fatigue of [0, 10, 20, 25, 30, 35, 40, 50])
    run(`edge +7, suits the trip, fatigue ${fatigue}`, { match: true, fits: true, edge: 7, fatigue });
  process.exit(0);
}
for (const edge of [0, 4, 7, 12])
  run(`edge +${edge}, suits the trip, house matched to trip`, { match: true, fits: true, edge, fatigue: 10 });
run("edge +7, wrong trip, house matched to trip", { match: true, fits: false, edge: 7, fatigue: 10 });
run("edge +7, wrong trip, house random trip", { match: false, fits: false, edge: 7, fatigue: 10 });
run("edge +7, suits the trip, fatigue 35 (just raced)", { match: true, fits: true, edge: 7, fatigue: 35 });
