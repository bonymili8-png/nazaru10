import { describe, expect, it } from "vitest";
import { defaultConfig as cfg, mergeConfig } from "../config/index.js";
import { allowanceAmount, classBandProblems, eligibleClasses, RATED_CLASSES } from "./classes.js";

describe("race class bands", () => {
  it("tile the rating line without gaps or overlaps", () => {
    expect(classBandProblems(cfg)).toEqual([]);
    expect(RATED_CLASSES).toEqual(["CLASS_5", "CLASS_4", "CLASS_3", "CLASS_2", "CLASS_1"]);
    for (let r = 500; r <= 2000; r++) {
      const rated = eligibleClasses(r, 1, cfg);
      expect(rated, `rating ${r}`).toHaveLength(1);
    }
  });

  it("puts each boundary rating in exactly the expected class", () => {
    const cases: [number, string][] = [
      [cfg.race.initialRating, "CLASS_5"],
      [1099, "CLASS_5"],
      [1100, "CLASS_4"],
      [1199, "CLASS_4"],
      [1200, "CLASS_3"],
      [1299, "CLASS_3"],
      [1300, "CLASS_2"],
      [1399, "CLASS_2"],
      [1400, "CLASS_1"],
      [2500, "CLASS_1"],
      [700, "CLASS_5"],
    ];
    for (const [r, c] of cases) expect(eligibleClasses(r, 3, cfg), `rating ${r}`).toEqual([c]);
  });

  it("opens maiden races only to horses that have never won, at any rating", () => {
    expect(eligibleClasses(1000, 0, cfg)).toEqual(["MAIDEN", "CLASS_5"]);
    expect(eligibleClasses(1250, 0, cfg)).toEqual(["MAIDEN", "CLASS_3"]);
    expect(eligibleClasses(1000, 1, cfg)).toEqual(["CLASS_5"]);
  });

  it("flags overlapping, gapped or unbounded settings", () => {
    const set = (classes: object) => mergeConfig(cfg, { race: { classes } });
    expect(classBandProblems(set({ CLASS_4: { minRating: 1050 } }))).toEqual([
      "race.classes.CLASS_4.minRating: must be CLASS_5.maxRating + 1",
    ]);
    expect(classBandProblems(set({ CLASS_3: { minRating: 1250 } }))).toEqual([
      "race.classes.CLASS_3.minRating: must be CLASS_4.maxRating + 1",
    ]);
    expect(classBandProblems(set({ CLASS_5: { minRating: 900 }, CLASS_1: { maxRating: 3000 } }))).toEqual([
      "race.classes.CLASS_5.minRating: must be null",
      "race.classes.CLASS_1.maxRating: must be null",
    ]);
    expect(classBandProblems(set({ CLASS_2: { minRating: 1500 } }))).toContain(
      "race.classes.CLASS_2: minRating is above maxRating",
    );
  });
});

describe("daily allowance", () => {
  const { amount, threshold } = cfg.economy.allowance;
  it("is the configured amount while it covers a start", () => {
    expect(allowanceAmount(0, [], cfg)).toBe(amount);
    expect(allowanceAmount(0, [{ rating: 1000, wins: 0 }], cfg)).toBe(amount);
    expect(allowanceAmount(threshold - 1, [{ rating: 1250, wins: 4 }], cfg)).toBe(amount);
  });
  it("tops up a broke owner of top-class horses to one entry fee, never more", () => {
    const fee1 = cfg.race.classes.CLASS_1.entryFee;
    expect(fee1).toBeGreaterThan(threshold + amount);
    expect(allowanceAmount(0, [{ rating: 1450, wins: 9 }], cfg)).toBe(fee1);
    expect(allowanceAmount(120, [{ rating: 1450, wins: 9 }], cfg)).toBe(fee1 - 120);
    // The cheapest horse of the string decides.
    expect(allowanceAmount(0, [{ rating: 1450, wins: 9 }, { rating: 1350, wins: 6 }], cfg)).toBe(
      cfg.race.classes.CLASS_2.entryFee,
    );
  });
});
