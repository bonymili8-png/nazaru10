import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import {
  facilityEffect,
  facilityMaxLevel,
  facilityRequiredStableLevel,
  facilityUpgradeCost,
  NO_FACILITIES,
} from "./index.js";

describe("facilities", () => {
  it("has no effect when nothing is built", () => {
    expect(facilityEffect(NO_FACILITIES, cfg)).toEqual({ gainMultiplier: 1, injuryMultiplier: 1 });
  });

  it("stacks track gains and clinic injury reduction, capped at max level", () => {
    const full = facilityEffect({ TRAINING_TRACK: 3, VET_CLINIC: 3 }, cfg);
    expect(full.gainMultiplier).toBeCloseTo(1.12, 5);
    expect(full.injuryMultiplier).toBeCloseTo(0.7, 5);
    expect(facilityEffect({ TRAINING_TRACK: 99, VET_CLINIC: 99 }, cfg)).toEqual(full);
  });

  it("prices levels progressively and gates them by stable level", () => {
    expect(facilityMaxLevel("TRAINING_TRACK", cfg)).toBe(3);
    const costs = [0, 1, 2].map((l) => facilityUpgradeCost("TRAINING_TRACK", l, cfg)!);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(facilityUpgradeCost("TRAINING_TRACK", 3, cfg)).toBeNull();
    expect(facilityRequiredStableLevel(1, cfg)).toBe(2);
    expect(facilityRequiredStableLevel(3, cfg)).toBeLessThanOrEqual(cfg.economy.stableCapacity.length);
  });
});
