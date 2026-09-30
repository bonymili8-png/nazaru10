import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { gallopLead, runGallop } from "./index.js";

describe("morning gallop", () => {
  it("the lead horse is always the same horse for a class, better in higher classes", () => {
    expect(gallopLead("CLASS_5", 1200, cfg)).toEqual(gallopLead("CLASS_5", 1200, cfg));
    const sum = (e: ReturnType<typeof gallopLead>) => Object.values(e.attributes).reduce((a, b) => a + b, 0);
    expect(sum(gallopLead("CLASS_1", 1200, cfg))).toBeGreaterThan(sum(gallopLead("MAIDEN", 1200, cfg)));
  });

  it("is deterministic by seed; a Maiden lead is easier to beat than a Class 1 lead", () => {
    const horse = { ...gallopLead("CLASS_4", 1200, cfg), id: "x" };
    expect(runGallop(horse, "MAIDEN", "TURF", 1200, "s", cfg)).toEqual(
      runGallop(horse, "MAIDEN", "TURF", 1200, "s", cfg),
    );
    let easy = 0;
    let hard = 0;
    for (let i = 0; i < 30; i++) {
      easy += runGallop(horse, "MAIDEN", "TURF", 1200, `s${i}`, cfg).margin;
      hard += runGallop(horse, "CLASS_1", "TURF", 1200, `s${i}`, cfg).margin;
    }
    expect(easy).toBeGreaterThan(hard);
  });

  it("a tired horse works slower than the same horse fresh", () => {
    const fresh = { ...gallopLead("CLASS_5", 1200, cfg), id: "x" };
    const tired = { ...fresh, condition: { ...fresh.condition, fatigue: 60 } };
    let a = 0;
    let b = 0;
    for (let i = 0; i < 30; i++) {
      a += runGallop(fresh, "CLASS_5", "DIRT", 1200, `t${i}`, cfg).time;
      b += runGallop(tired, "CLASS_5", "DIRT", 1200, `t${i}`, cfg).time;
    }
    expect(b).toBeGreaterThan(a);
  });
});
