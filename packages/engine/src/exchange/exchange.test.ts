import { describe, expect, it } from "vitest";
import { defaultConfig, type GameConfig, mergeConfig } from "../config/index.js";
import { gemExchangeBaseRate, gemExchangeOffers, gemExchangeProblems } from "./index.js";

const withBundles = (bundles: { gems: number; credits: number }[], dailyCreditLimit = 10_000): GameConfig =>
  mergeConfig(defaultConfig, { economy: { gemExchange: { bundles, dailyCreditLimit } } });

describe("gem exchange", () => {
  it("defaults to 10 credits a gem with a growing bonus for bigger bundles", () => {
    expect(gemExchangeBaseRate(defaultConfig)).toBe(10);
    expect(gemExchangeOffers(defaultConfig)).toEqual([
      { gems: 50, credits: 500, bonusPct: 0 },
      { gems: 100, credits: 1_100, bonusPct: 10 },
      { gems: 250, credits: 3_000, bonusPct: 20 },
      { gems: 550, credits: 7_000, bonusPct: 27 },
    ]);
    expect(gemExchangeProblems(defaultConfig)).toEqual([]);
  });

  it("orders bundles by gems whatever order the admin wrote them in", () => {
    const cfg = withBundles([
      { gems: 200, credits: 2_400 },
      { gems: 20, credits: 200 },
    ]);
    expect(gemExchangeOffers(cfg).map((o) => [o.gems, o.bonusPct])).toEqual([
      [20, 0],
      [200, 20],
    ]);
  });

  it("rejects bundles that are not whole positive amounts or repeat a gem price", () => {
    expect(gemExchangeProblems(withBundles([{ gems: 0, credits: 10 }]))).toHaveLength(1);
    expect(gemExchangeProblems(withBundles([{ gems: 10, credits: 1.5 }]))).toHaveLength(1);
    expect(
      gemExchangeProblems(
        withBundles([
          { gems: 10, credits: 100 },
          { gems: 10, credits: 120 },
        ]),
      ),
    ).toHaveLength(1);
    expect(gemExchangeProblems(withBundles([{ gems: 10, credits: 100 }], -1))).toHaveLength(1);
  });

  it("offers nothing when no bundles are configured", () => {
    const cfg = withBundles([]);
    expect(gemExchangeBaseRate(cfg)).toBe(0);
    expect(gemExchangeOffers(cfg)).toEqual([]);
  });
});
