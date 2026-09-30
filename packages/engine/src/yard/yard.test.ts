import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { Rng } from "../rng.js";
import { yardEventFor, yardOutcome, yardWindow } from "./index.js";

const horses = [
  { id: "a", lastRaceAt: null },
  { id: "b", lastRaceAt: null },
];

describe("yard events", () => {
  it("are deterministic per owner and window, about as often as configured", () => {
    let n = 0;
    for (let w = 0; w < 2000; w++) {
      const e = yardEventFor("owner", w, horses, cfg);
      expect(yardEventFor("owner", w, horses, cfg)).toEqual(e);
      if (!e) continue;
      n++;
      expect(yardWindow(e.at, cfg)).toBe(w);
    }
    expect(n / 2000).toBeGreaterThan(cfg.yard.chancePerWindow - 0.05);
    expect(n / 2000).toBeLessThan(cfg.yard.chancePerWindow + 0.05);
  });

  it("only unraced events for horses that have not raced; heat only just after a race", () => {
    for (let w = 0; w < 500; w++) {
      const e = yardEventFor("x", w, horses, cfg);
      if (e) expect(["OFF_FEED", "CAST_IN_BOX"]).toContain(e.kind);
    }
    const kinds = new Set<string>();
    for (let w = 1000; w < 1500; w++) {
      const start = new Date(w * cfg.yard.windowHours * 3_600_000);
      const e = yardEventFor("y", w, [{ id: "a", lastRaceAt: start }], cfg);
      if (e) kinds.add(e.kind);
    }
    expect(kinds).toEqual(new Set(["LOST_SHOE", "HEAT_IN_LEG", "OFF_FEED", "CAST_IN_BOX"]));
  });

  it("no horses, no event; buying a horse never changes whether one happens", () => {
    for (let w = 0; w < 200; w++) {
      expect(yardEventFor("z", w, [], cfg)).toBeNull();
      const one = yardEventFor("z", w, [horses[0]!], cfg);
      const two = yardEventFor("z", w, horses, cfg);
      expect(one === null).toBe(two === null);
    }
  });

  it("each choice trades a cost against a risk", () => {
    const rng = new Rng("t");
    expect(yardOutcome("LOST_SHOE", "ACT", rng, cfg)).toMatchObject({ credits: 80, freshShoes: true });
    expect(yardOutcome("LOST_SHOE", "WAIT", rng, cfg)).toMatchObject({ credits: 0, shoesWorn: true });
    expect(yardOutcome("HEAT_IN_LEG", "ACT", rng, cfg)).toMatchObject({ fatigue: 20, injuryFactor: 1 });
    expect(yardOutcome("HEAT_IN_LEG", "WAIT", rng, cfg).injuryFactor).toBe(1.6);
    expect(yardOutcome("OFF_FEED", "WAIT", rng, cfg).health).toBe(-12);
    let bad = 0;
    for (let i = 0; i < 1000; i++) if (yardOutcome("CAST_IN_BOX", "WAIT", rng, cfg).bad) bad++;
    expect(bad / 1000).toBeCloseTo(0.35, 1);
  });
});
