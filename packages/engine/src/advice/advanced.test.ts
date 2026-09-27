import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { type Aptitudes, type Attributes, TRAINABLE_ATTRIBUTES, type Traits } from "../horse/types.js";
import { advancedAdvice, sessionFor } from "./advanced.js";

const flat = (v: number) => Object.fromEntries(TRAINABLE_ATTRIBUTES.map((k) => [k, v])) as Attributes;
const calm: Traits = { temperament: 60, courage: 50, consistency: 50, drive: 50, stressResistance: 50 };
const apt = (optimalDistance: number, wet = 50, distanceRange = 50): Aptitudes => ({
  surface: { TURF: 40, DIRT: 75, SYNTHETIC: 55 },
  wet,
  optimalDistance,
  distanceRange,
});

describe("advanced trainer's advice", () => {
  it("suits tactics to the horse's shape", () => {
    const speedster = { ...flat(50), start: 80, acceleration: 80, speed: 80, finalKick: 40, stamina: 40 };
    const front = advancedAdvice(speedster, calm, apt(1200), null, cfg).tactics.map((x) => x.strategy);
    expect(["FRONT_RUNNER", "AGGRESSIVE", "PACE_SETTER"]).toContain(front[0]);
    const closer = { ...flat(50), start: 40, acceleration: 40, speed: 55, finalKick: 85, stamina: 80 };
    const late = advancedAdvice(closer, calm, apt(1600), null, cfg).tactics.map((x) => x.strategy);
    expect(["CLOSER", "MID_PACK"]).toContain(late[0]);
    // A keen horse is told to settle.
    const keen = advancedAdvice(flat(55), { ...calm, temperament: 20 }, apt(2400), null, cfg);
    expect(keen.tactics.some((x) => x.strategy === "CONSERVATIVE" && x.reasons.includes("KEEN"))).toBe(true);
    expect(keen.traits).toContain("KEEN");
  });

  it("describes the ideal conditions", () => {
    const a = advancedAdvice(flat(50), calm, apt(1600, 80, 20), null, cfg);
    expect(a.going).toBe("SOFT");
    expect(a.surfaces[0]).toEqual({ surface: "DIRT", affinity: 75 });
    expect(a.distance.best).toBe(1600);
    expect(a.distance.min).toBeLessThan(1600);
    expect(a.distance.max).toBeGreaterThan(1600);
    const flexible = advancedAdvice(flat(50), calm, apt(1600, 20, 90), null, cfg);
    expect(flexible.going).toBe("FIRM");
    expect(flexible.distance.max - flexible.distance.min).toBeGreaterThan(a.distance.max - a.distance.min);
  });

  it("suggests gear and a training plan, using ceilings only when diagnosed", () => {
    const weakStart = { ...flat(70), start: 30 };
    const a = advancedAdvice(weakStart, calm, apt(1200), null, cfg);
    expect(a.gear.length).toBeGreaterThan(0);
    expect(a.training).toHaveLength(3);
    expect(a.training[0]).toMatchObject({ attribute: "start", type: "STARTS", headroom: null });
    // With diagnostics, an attribute already at its ceiling is not worth training.
    const ceilings = { ...flat(95), start: 31 };
    const d = advancedAdvice(weakStart, calm, apt(1200), ceilings, cfg);
    expect(d.training.map((x) => x.attribute)).not.toContain("start");
    expect(d.training[0]!.headroom).toBeGreaterThan(0);
    expect(sessionFor("stamina", cfg)).toBe("STAMINA");
  });
});
