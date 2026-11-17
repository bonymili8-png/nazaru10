import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { type Attributes, TRAINABLE_ATTRIBUTES } from "../horse/types.js";
import { autoSlotAt, autoTrainingPlan } from "./auto.js";

const attributes = Object.fromEntries(TRAINABLE_ATTRIBUTES.map((k) => [k, 50])) as Attributes;
// A sprinter whose speed lags most.
attributes.speed = 30;
const aptitudes = {
  surface: { TURF: 50, DIRT: 50, SYNTHETIC: 50 },
  wet: 50,
  optimalDistance: 1200,
  distanceRange: 50,
};
const fresh = { fatigue: 0, health: 100, form: 0 };
const plan = (over: Partial<Parameters<typeof autoTrainingPlan>[0]> = {}) =>
  autoTrainingPlan(
    { slot: "MORNING", attributes, aptitudes, condition: fresh, age: 3, recent: [], ...over },
    cfg,
  );

describe("auto-trainer", () => {
  it("runs at 09:00–16:00 and 16:00–22:00 local time only", () => {
    expect(autoSlotAt(8, cfg)).toBeNull();
    expect(autoSlotAt(9, cfg)).toBe("MORNING");
    expect(autoSlotAt(15, cfg)).toBe("MORNING");
    expect(autoSlotAt(16, cfg)).toBe("AFTERNOON");
    expect(autoSlotAt(21, cfg)).toBe("AFTERNOON");
    expect(autoSlotAt(22, cfg)).toBeNull();
  });

  it("trains the most relevant attribute first, hard in a rested prime horse", () => {
    expect(plan()).toEqual({ type: "SPEED", intensity: "HARD", attribute: "speed" });
    // Not rested: no morning session.
    expect(plan({ condition: { ...fresh, fatigue: 4 } })).toEqual({ skip: "NOT_RESTED" });
    // Older, or not fully healthy: a normal session; a yearling trains lightly.
    expect(plan({ age: 7 })).toMatchObject({ intensity: "NORMAL" });
    expect(plan({ condition: { ...fresh, health: 85 } })).toMatchObject({ intensity: "NORMAL" });
    expect(plan({ age: 1.5 })).toMatchObject({ intensity: "LIGHT" });
    expect(plan({ age: 0.5 })).toEqual({ skip: "TOO_YOUNG" });
  });

  it("then balances between the other relevant attributes", () => {
    const second = plan({ recent: ["SPEED"] });
    expect("type" in second && second.type).not.toBe("SPEED");
    const seen = new Set<string>();
    const recent: Parameters<typeof autoTrainingPlan>[0]["recent"] = [];
    for (let i = 0; i < 4; i++) {
      const p = plan({ recent: [...recent] });
      if (!("type" in p)) throw new Error("no plan");
      seen.add(p.type);
      recent.unshift(p.type);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it("adds a safe normal afternoon session on another attribute", () => {
    const pm = autoTrainingPlan(
      {
        slot: "AFTERNOON",
        attributes,
        aptitudes,
        condition: { ...fresh, fatigue: 15 },
        age: 3,
        recent: ["SPEED"],
      },
      cfg,
    );
    expect(pm).toMatchObject({ intensity: "NORMAL" });
    expect("type" in pm && pm.type).not.toBe("SPEED");
    // Too tired for a safe second session (now, or once it is done), or not healthy enough.
    expect(
      autoTrainingPlan(
        {
          slot: "AFTERNOON",
          attributes,
          aptitudes,
          condition: { ...fresh, fatigue: 35 },
          age: 3,
          recent: [],
        },
        cfg,
      ),
    ).toEqual({ skip: "UNSAFE" });
    expect(
      autoTrainingPlan(
        {
          slot: "AFTERNOON",
          attributes,
          aptitudes,
          condition: { ...fresh, fatigue: 30 },
          age: 3,
          recent: [],
        },
        cfg,
      ),
    ).toEqual({ skip: "UNSAFE" });
    expect(
      autoTrainingPlan(
        {
          slot: "AFTERNOON",
          attributes,
          aptitudes,
          condition: { ...fresh, fatigue: 5, health: 70 },
          age: 3,
          recent: [],
        },
        cfg,
      ),
    ).toEqual({ skip: "HEALTH" });
  });
});
