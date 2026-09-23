import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { Rng } from "../rng.js";
import { buildCommentary } from "./commentary.js";
import { raceAftermath } from "./aftermath.js";
import { splitPurse, updateRatings } from "./rating.js";
import { simulateRace, seedHash, type RaceEntrant } from "./simulate.js";
import { isInTurn, trackByCode, TRACKS } from "./track.js";
import { randomEntrant, validateRaces } from "./validation.js";

const field = (seed: string, n = 8): RaceEntrant[] => {
  const rng = new Rng(seed);
  return Array.from({ length: n }, (_, i) => randomEntrant(rng, `h${i}`, 0.5, cfg));
};
const setup = {
  distance: 1600,
  track: trackByCode("EUROTURF"),
  weather: "SUNNY" as const,
  wetness: 1 as const,
};

describe("race simulation", () => {
  it("is fully deterministic for the same seed", () => {
    const f = field("det");
    expect(simulateRace(f, setup, "seed-1", cfg)).toEqual(simulateRace(f, setup, "seed-1", cfg));
  });

  it("changes with the seed", () => {
    const f = field("det");
    const a = simulateRace(f, setup, "seed-1", cfg).results.map((r) => r.entrantId);
    const outcomes = new Set([a.join()]);
    for (let i = 2; i < 12; i++)
      outcomes.add(
        simulateRace(f, setup, `seed-${i}`, cfg)
          .results.map((r) => r.entrantId)
          .join(),
      );
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("produces a complete, consistent result table", () => {
    for (const track of TRACKS) {
      for (const distance of track.distances) {
        const f = field(`${track.code}${distance}`, 12);
        const res = simulateRace(f, { distance, track, weather: "RAIN", wetness: 2 }, `s${distance}`, cfg);
        expect(res.results).toHaveLength(12);
        expect(new Set(res.results.map((r) => r.entrantId)).size).toBe(12);
        expect(res.results[0]!.position).toBe(1);
        for (let k = 1; k < res.results.length; k++) {
          expect(res.results[k]!.time).toBeGreaterThanOrEqual(res.results[k - 1]!.time);
          expect(res.results[k]!.position).toBeGreaterThanOrEqual(res.results[k - 1]!.position);
        }
        const speed = distance / res.winningTime;
        expect(speed).toBeGreaterThan(13);
        expect(speed).toBeLessThan(19);
      }
    }
  });

  it("frames are monotonic in progress and bounded by the distance", () => {
    const res = simulateRace(field("frames"), setup, "f", cfg);
    for (let k = 1; k < res.frames.data.length; k++) {
      res.frames.data[k]!.forEach((row, i) => {
        expect(row[0]).toBeGreaterThanOrEqual(res.frames.data[k - 1]![i]![0]);
        expect(row[0]).toBeLessThanOrEqual(setup.distance);
        expect(row[1]).toBeGreaterThanOrEqual(0);
      });
    }
    const last = res.frames.data[res.frames.data.length - 1]!;
    expect(last.every((row) => row[0] === setup.distance)).toBe(true);
  });

  it("events reference entrants and end with FINISH for the winner", () => {
    const f = field("events");
    const res = simulateRace(f, setup, "e", cfg);
    const ids = new Set(f.map((e) => e.id));
    for (const e of res.events) if (e.horseId) expect(ids.has(e.horseId)).toBe(true);
    const finish = res.events.filter((e) => e.type === "FINISH");
    expect(finish).toHaveLength(1);
    expect(finish[0]!.horseId).toBe(res.results[0]!.entrantId);
    const names = Object.fromEntries(f.map((e) => [e.id, e.name]));
    const lines = buildCommentary(res.events, names, "e");
    expect(lines).toHaveLength(res.events.length);
    expect(lines.every((l) => !l.text.includes("{"))).toBe(true);
  });

  it("a clearly superior horse wins most head-to-heads", () => {
    const rng = new Rng("sup");
    let wins = 0;
    for (let i = 0; i < 200; i++) {
      const strong = randomEntrant(rng, "strong", 0.9, cfg, "MID_PACK");
      const weak = randomEntrant(rng, "weak", 0.2, cfg, "MID_PACK");
      strong.aptitudes = { ...strong.aptitudes, optimalDistance: 1600 };
      weak.aptitudes = { ...weak.aptitudes, optimalDistance: 1600 };
      if (simulateRace([strong, weak], setup, `h2h${i}`, cfg).results[0]!.entrantId === "strong") wins++;
    }
    expect(wins / 200).toBeGreaterThan(0.9);
  });

  it("fatigue hurts performance", () => {
    const rng = new Rng("fat");
    let freshWins = 0;
    for (let i = 0; i < 300; i++) {
      const a = randomEntrant(rng, "fresh", 0.5, cfg, "MID_PACK");
      const b = { ...a, id: "tired", condition: { ...a.condition, fatigue: 80 } };
      a.condition = { ...a.condition, fatigue: 0 };
      if (simulateRace(i % 2 ? [a, b] : [b, a], setup, `fat${i}`, cfg).results[0]!.entrantId === "fresh")
        freshWins++;
    }
    expect(freshWins / 300).toBeGreaterThan(0.75);
  });

  it("rejects invalid fields", () => {
    const f = field("bad", 2);
    expect(() => simulateRace([f[0]!], setup, "x", cfg)).toThrow(RangeError);
    expect(() => simulateRace([f[0]!, f[0]!], setup, "x", cfg)).toThrow(RangeError);
  });

  it("publishes a seed hash that does not reveal the seed", () => {
    expect(seedHash("abc")).toHaveLength(32);
    expect(seedHash("abc")).not.toContain("abc");
    expect(seedHash("abc")).not.toBe(seedHash("abd"));
  });

  it("maps oval positions: races finish in the home straight", () => {
    const t = trackByCode("STADIUM");
    for (const d of t.distances) expect(isInTurn(t, d, d - 10)).toBe(false);
  });
});

describe("statistical validation (CI subset, see pnpm sim:races for full runs)", () => {
  const report = validateRaces(1200, "ci", cfg);
  it("favourite performance is believable", () => {
    expect(report.favouriteWinRate).toBeGreaterThan(0.26);
    expect(report.favouriteWinRate).toBeLessThan(0.48);
    expect(report.favouriteTop3Rate).toBeGreaterThan(0.55);
    expect(report.favouriteTop3Rate).toBeLessThan(0.85);
    expect(report.meanSpearman).toBeGreaterThan(0.4);
    expect(report.meanSpearman).toBeLessThan(0.85);
  });
  it("upsets happen but the weakest rarely wins", () => {
    expect(report.weakestWinRate).toBeGreaterThan(0);
    expect(report.weakestWinRate).toBeLessThan(0.04);
  });
  it("no dominant strategy and limited draw bias", () => {
    for (const share of Object.values(report.strategyWinShare)) {
      expect(share).toBeGreaterThan(0.06);
      expect(share).toBeLessThan(0.34);
    }
    expect(report.gateBias).toBeLessThan(1.8);
  });
});

describe("ratings, purses, aftermath", () => {
  it("Elo is zero-sum (up to rounding) and rewards winners", () => {
    const field = [
      { id: "a", rating: 1000, position: 1 },
      { id: "b", rating: 1000, position: 2 },
      { id: "c", rating: 1000, position: 3 },
    ];
    const next = updateRatings(field, 32);
    expect(next.get("a")!).toBeGreaterThan(1000);
    expect(next.get("c")!).toBeLessThan(1000);
    const total = [...next.values()].reduce((s, x) => s + x, 0);
    expect(Math.abs(total - 3000)).toBeLessThanOrEqual(2);
  });

  it("splits purses without over-paying, sharing dead heats", () => {
    const split = cfg.race.prizeSplit;
    const normal = splitPurse(
      10_000,
      [1, 2, 3, 4, 5, 6, 7, 8].map((p) => ({ id: `h${p}`, position: p })),
      split,
    );
    expect([...normal.values()].reduce((s, x) => s + x, 0)).toBe(10_000);
    expect(normal.get("h1")).toBe(5000);
    expect(normal.get("h7")).toBe(0);
    const dh = splitPurse(
      10_000,
      [
        { id: "a", position: 1 },
        { id: "b", position: 1 },
        { id: "c", position: 3 },
      ],
      split,
    );
    expect(dh.get("a")).toBe(dh.get("b"));
    expect([...dh.values()].reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(10_000);
    const small = splitPurse(
      1000,
      [
        { id: "a", position: 1 },
        { id: "b", position: 2 },
      ],
      split,
    );
    expect([...small.values()].reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(1000);
  });

  it("aftermath adds fatigue and moves form with surprise", () => {
    const before = { fatigue: 10, health: 100, form: 0 };
    const good = raceAftermath(
      before,
      { distance: 1600, position: 1, expectedPosition: 6, fieldSize: 10, endurance: 50, susceptibility: 1 },
      new Rng("a"),
      cfg,
    );
    const bad = raceAftermath(
      before,
      { distance: 1600, position: 9, expectedPosition: 2, fieldSize: 10, endurance: 50, susceptibility: 1 },
      new Rng("a"),
      cfg,
    );
    expect(good.condition.fatigue).toBeGreaterThan(10);
    expect(good.condition.form).toBeGreaterThan(0);
    expect(bad.condition.form).toBeLessThan(0);
  });
});
