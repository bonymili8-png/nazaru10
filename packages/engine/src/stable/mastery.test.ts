import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { masteryPerks, masteryProgress } from "./mastery.js";

const none = { trainings: 0, starts: 0, podiums: 0, foals: 0 };

describe("stable mastery", () => {
  it("starts with no edge and levels up with experience", () => {
    expect(masteryPerks(none, cfg)).toEqual({ trainingGain: 1, raceFatigue: 1, gestation: 1 });
    expect(masteryProgress("TRAINING", { ...none, trainings: 9 }, cfg)).toMatchObject({
      level: 0,
      nextAt: 10,
    });
    expect(masteryProgress("TRAINING", { ...none, trainings: 10 }, cfg)).toMatchObject({
      level: 1,
      nextAt: 30,
    });
    // Podiums count on top of starts.
    expect(masteryProgress("RACING", { ...none, starts: 20, podiums: 10 }, cfg).level).toBe(2);
    expect(masteryProgress("BREEDING", { ...none, foals: 99 }, cfg)).toMatchObject({
      level: 5,
      nextAt: null,
    });
  });

  it("caps the edges at the top level", () => {
    const max = { trainings: 999, starts: 999, podiums: 999, foals: 999 };
    const p = masteryPerks(max, cfg);
    expect(p.trainingGain).toBeCloseTo(1.05);
    expect(p.raceFatigue).toBeCloseTo(0.9);
    expect(p.gestation).toBeCloseTo(0.75);
  });
});
