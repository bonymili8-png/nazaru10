import { describe, expect, it } from "vitest";
import { defaultConfig as cfg, GEAR_ITEMS } from "../config/index.js";
import { TRAINABLE_ATTRIBUTES, type Attributes } from "../horse/types.js";
import { applyGear } from "./index.js";

const flat = (v: number) => Object.fromEntries(TRAINABLE_ATTRIBUTES.map((k) => [k, v])) as Attributes;

describe("race-day gear", () => {
  it("leaves attributes untouched without gear", () => {
    const a = flat(50);
    expect(applyGear(a, null, cfg)).toBe(a);
  });

  it("every item trades a gain for a loss", () => {
    for (const g of GEAR_ITEMS) {
      const mods = Object.values(cfg.equipment[g].mods);
      expect(
        mods.some((d) => d > 0),
        g,
      ).toBe(true);
      expect(
        mods.some((d) => d < 0),
        g,
      ).toBe(true);
      const out = applyGear(flat(50), g, cfg);
      for (const [k, d] of Object.entries(cfg.equipment[g].mods))
        expect(out[k as keyof Attributes]).toBe(50 + d);
    }
  });

  it("keeps values within 1–100 and does not mutate the input", () => {
    const a = flat(99);
    a.endurance = 2;
    const out = applyGear(a, "RACING_PLATES", cfg);
    expect(out.speed).toBe(100);
    expect(out.endurance).toBe(1);
    expect(a.speed).toBe(99);
  });
});
