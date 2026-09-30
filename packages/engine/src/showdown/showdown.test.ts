import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { Rng } from "../rng.js";
import { SHOWDOWN_CODE, showdownCode, showdownHorse, showdownPoints } from "./index.js";

describe("showdowns", () => {
  it("tournament horses are deterministic, equally bred, with different profiles", () => {
    expect(showdownHorse("a", cfg)).toEqual(showdownHorse("a", cfg));
    const horses = Array.from({ length: 40 }, (_, i) => showdownHorse(`h${i}`, cfg));
    const sums = horses.map((h) => Object.values(h.attributes).reduce((x, y) => x + y, 0));
    const mean = sums.reduce((a, b) => a + b) / sums.length;
    // Same breeding: no horse is wildly better than the rest.
    expect(Math.max(...sums) / mean).toBeLessThan(1.3);
    expect(new Set(horses.map((h) => Math.round(h.aptitudes.optimalDistance / 200))).size).toBeGreaterThan(2);
  });

  it("scores players by their order among players", () => {
    expect([1, 2, 3, 8, 9].map((r) => showdownPoints(r, cfg))).toEqual([10, 8, 6, 1, 0]);
  });

  it("invite codes are six unambiguous characters", () => {
    const rng = new Rng("c");
    for (let i = 0; i < 50; i++) expect(showdownCode(rng)).toMatch(SHOWDOWN_CODE);
  });
});
