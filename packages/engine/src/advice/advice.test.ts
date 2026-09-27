import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { type Aptitudes, type Attributes, TRAINABLE_ATTRIBUTES } from "../horse/types.js";
import { distanceProfile, raceFit, trainingAdvice } from "./index.js";

const flat = (v: number) => Object.fromEntries(TRAINABLE_ATTRIBUTES.map((k) => [k, v])) as Attributes;
const apt = (optimalDistance: number): Aptitudes => ({
  surface: { TURF: 80, DIRT: 40, SYNTHETIC: 50 },
  wet: 50,
  optimalDistance,
  distanceRange: 50,
});

describe("trainer's advice", () => {
  it("classifies trips", () => {
    expect([1200, 1600, 2400].map(distanceProfile)).toEqual(["SPRINTER", "MILER", "STAYER"]);
  });

  it("targets the biggest gap that matters for the horse's trip", () => {
    const sprinter = { ...flat(60), start: 30 };
    expect(trainingAdvice(sprinter, apt(1200), cfg)).toEqual({
      profile: "SPRINTER",
      attribute: "start",
      type: "STARTS",
    });
    // The same weak start matters little for a stayer; weak stamina does.
    const stayer = { ...flat(60), start: 30, stamina: 40 };
    expect(trainingAdvice(stayer, apt(2400), cfg)).toMatchObject({ attribute: "stamina", type: "STAMINA" });
  });

  it("ranks races by distance and surface fit", () => {
    const a = apt(1600);
    expect(raceFit(a, { distance: 1600, surface: "TURF" })).toBeLessThan(
      raceFit(a, { distance: 1600, surface: "DIRT" }),
    );
    expect(raceFit(a, { distance: 1600, surface: "TURF" })).toBeLessThan(
      raceFit(a, { distance: 2400, surface: "TURF" }),
    );
  });
});
