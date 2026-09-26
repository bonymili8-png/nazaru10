import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.js";
import { sponsorOffers, sponsorQualifies, sponsorWeek, sponsorWeekStart } from "./index.js";

describe("sponsors", () => {
  const run = { surface: "TURF" as const, distance: 1400, wetness: 1, position: 2 };

  it("qualifies runs by result, surface, distance and going", () => {
    expect(sponsorQualifies({ result: "TOP3", surface: "TURF", count: 2 }, run)).toBe(true);
    expect(sponsorQualifies({ result: "TOP3", surface: "DIRT", count: 2 }, run)).toBe(false);
    expect(sponsorQualifies({ result: "WIN", count: 1 }, run)).toBe(false);
    expect(sponsorQualifies({ result: "START", maxDistance: 1200, count: 2 }, run)).toBe(false);
    expect(sponsorQualifies({ result: "START", minDistance: 1400, count: 2 }, run)).toBe(true);
    expect(sponsorQualifies({ result: "START", minWetness: 2, count: 2 }, run)).toBe(false);
    expect(sponsorQualifies({ result: "TOP3", count: 4 }, { ...run, position: 4 })).toBe(false);
  });

  it("offers three distinct sponsors per owner and week, deterministically", () => {
    const a = sponsorOffers("owner-1", 2900, defaultConfig).map((s) => s.code);
    expect(a).toHaveLength(defaultConfig.sponsors.offersPerWeek);
    expect(new Set(a).size).toBe(a.length);
    expect(sponsorOffers("owner-1", 2900, defaultConfig).map((s) => s.code)).toEqual(a);
    const weeks = new Set(
      Array.from({ length: 12 }, (_, i) =>
        sponsorOffers("owner-1", 2900 + i, defaultConfig)
          .map((s) => s.code)
          .join(),
      ),
    );
    expect(weeks.size).toBeGreaterThan(1);
  });

  it("uses Monday-based weeks", () => {
    const monday = new Date("2026-09-28T00:00:00Z");
    const sunday = new Date("2026-09-27T23:59:59Z");
    expect(sponsorWeek(monday)).toBe(sponsorWeek(sunday) + 1);
    expect(sponsorWeekStart(sponsorWeek(monday)).toISOString()).toBe(monday.toISOString());
  });
});
