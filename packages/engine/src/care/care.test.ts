import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { bondNow, careAvailability, careInjuryFactor, type CareState, traitsWithBond } from "./index.js";

const t0 = new Date("2026-01-01T00:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const base: CareState = {
  bond: 0,
  bondAt: t0,
  last: {},
  shoeStarts: 0,
  massaged: false,
  lastRaceAt: null,
  hosedLastRace: false,
};

describe("daily care", () => {
  it("puts each action on its own cooldown", () => {
    expect(careAvailability("GROOM", base, t0, cfg).block).toBeNull();
    const groomed = { ...base, last: { GROOM: t0.toISOString() } };
    const a = careAvailability("GROOM", groomed, h(2), cfg);
    expect(a.block).toBe("COOLDOWN");
    expect(a.availableAt).toEqual(h(8));
    expect(careAvailability("GROOM", groomed, h(8), cfg).block).toBeNull();
    // Other actions are independent.
    expect(careAvailability("HAND_WALK", groomed, h(2), cfg).block).toBeNull();
  });

  it("cold-hoses only soon after a race, once per race", () => {
    expect(careAvailability("COLD_HOSE", base, t0, cfg).block).toBe("NO_RECENT_RACE");
    const raced = { ...base, lastRaceAt: t0 };
    expect(careAvailability("COLD_HOSE", raced, h(5), cfg).block).toBeNull();
    expect(careAvailability("COLD_HOSE", raced, h(7), cfg).block).toBe("NO_RECENT_RACE");
    expect(careAvailability("COLD_HOSE", { ...raced, hosedLastRace: true }, h(1), cfg).block).toBe(
      "ALREADY_HOSED",
    );
  });

  it("calls the farrier only once shoes have been raced on", () => {
    expect(careAvailability("FARRIER", base, t0, cfg).block).toBe("SHOES_FRESH");
    expect(careAvailability("FARRIER", { ...base, shoeStarts: 2 }, t0, cfg).block).toBeNull();
  });

  it("builds trust that fades without care, and a trusting horse is steadier", () => {
    expect(bondNow(40, t0, h(48), cfg)).toBeCloseTo(40 - 2 * cfg.care.bondDecayPerDay);
    expect(bondNow(5, t0, h(24 * 30), cfg)).toBe(0);
    const traits = { temperament: 40, courage: 50, consistency: 50, drive: 50, stressResistance: 50 };
    const steady = traitsWithBond(traits, 100, cfg);
    expect(steady.consistency).toBe(70);
    expect(steady.temperament).toBe(50);
    expect(traitsWithBond(traits, 0, cfg)).toEqual(traits);
  });

  it("lowers the injury risk after a massage and raises it on worn shoes", () => {
    expect(careInjuryFactor({ massaged: false, shoeStarts: 0 }, cfg)).toBe(1);
    expect(careInjuryFactor({ massaged: true, shoeStarts: 0 }, cfg)).toBeCloseTo(0.7);
    expect(careInjuryFactor({ massaged: false, shoeStarts: cfg.care.shoeStarts }, cfg)).toBeCloseTo(1.4);
  });
});

describe("stable lads", () => {
  it("one lad per five horses, two for the whole yard", async () => {
    const { ladsNeeded, ladsCover, ladJobs } = await import("./index.js");
    const { defaultConfig: cfg } = await import("../config/index.js");
    expect([0, 1, 5, 6, 20].map((n) => ladsNeeded(n, cfg))).toEqual([1, 1, 1, 2, 2]);
    expect(ladsCover(1, cfg)).toBe(5);
    expect(ladsCover(2, cfg)).toBe(Number.POSITIVE_INFINITY);
    expect(ladJobs(["GROOM", "FARRIER"], { shoeStarts: 2 }, cfg)).toEqual(["GROOM"]);
    expect(ladJobs(["GROOM", "FARRIER"], { shoeStarts: 6 }, cfg)).toEqual(["GROOM", "FARRIER"]);
  });
});
