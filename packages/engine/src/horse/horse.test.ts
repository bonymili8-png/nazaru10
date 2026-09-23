import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { Rng } from "../rng.js";
import { projectCondition, fatigueModifier, hoursUntilFatigue } from "./condition.js";
import { generateGenome, initialAttributes } from "./generate.js";
import { ageInYears, ageTrainingMultiplier, birthDateForAge, lifeStage } from "./lifecycle.js";
import { abilityRating } from "./rating.js";
import { assertTransition, canTransition, IllegalTransitionError } from "./state-machine.js";
import { TRAINABLE_ATTRIBUTES } from "./types.js";

describe("horse generation", () => {
  it("keeps every value within bounds and current ≤ ceiling", () => {
    const rng = new Rng("gen");
    for (let i = 0; i < 2000; i++) {
      const g = generateGenome(rng, { quality: rng.next() }, cfg);
      const attrs = initialAttributes(g, rng.float(0, 8), rng);
      for (const a of TRAINABLE_ATTRIBUTES) {
        expect(g.ceilings[a]).toBeGreaterThanOrEqual(20);
        expect(g.ceilings[a]).toBeLessThanOrEqual(99);
        expect(attrs[a]).toBeGreaterThan(0);
        expect(attrs[a]).toBeLessThanOrEqual(g.ceilings[a]);
      }
      expect(g.aptitudes.optimalDistance).toBeGreaterThanOrEqual(1000);
      expect(g.aptitudes.optimalDistance).toBeLessThanOrEqual(3200);
      expect(g.hidden.injurySusceptibility).toBeGreaterThanOrEqual(0.5);
      expect(g.hidden.injurySusceptibility).toBeLessThanOrEqual(1.5);
    }
  });

  it("higher quality yields higher ceilings on average", () => {
    const rng = new Rng("q");
    const avg = (q: number) => {
      let s = 0;
      for (let i = 0; i < 400; i++) {
        const g = generateGenome(rng, { quality: q, rarity: "COMMON" }, cfg);
        s += TRAINABLE_ATTRIBUTES.reduce((t, a) => t + g.ceilings[a], 0) / TRAINABLE_ATTRIBUTES.length;
      }
      return s / 400;
    };
    expect(avg(0.9)).toBeGreaterThan(avg(0.1) + 25);
  });

  it("ability rating is monotonic in attributes", () => {
    const rng = new Rng("r");
    const g = generateGenome(rng, { quality: 0.5 }, cfg);
    const a = initialAttributes(g, 3, rng);
    const better = { ...a, speed: a.speed + 5 };
    expect(abilityRating(better, g.traits)).toBeGreaterThan(abilityRating(a, g.traits));
  });
});

describe("lifecycle", () => {
  it("round-trips ages and maps stages", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(ageInYears(birthDateForAge(3.5, now, cfg), now, cfg)).toBeCloseTo(3.5, 6);
    expect(lifeStage(0.5, cfg)).toBe("FOAL");
    expect(lifeStage(2.5, cfg)).toBe("JUVENILE");
    expect(lifeStage(4, cfg)).toBe("PRIME");
    expect(lifeStage(7, cfg)).toBe("VETERAN");
    expect(lifeStage(10, cfg)).toBe("RETIRED");
  });

  it("late developers keep a higher training multiplier for longer", () => {
    expect(ageTrainingMultiplier(6.2, 1, cfg)).toBeGreaterThan(ageTrainingMultiplier(6.2, -1, cfg));
  });
});

describe("condition", () => {
  const stored = { fatigue: 80, health: 50, form: 1, updatedAt: new Date("2026-01-01T00:00:00Z") };

  it("recovers fatigue, regenerates health and decays form over time", () => {
    const later = projectCondition(stored, new Date("2026-01-01T05:00:00Z"), 50, cfg);
    expect(later.fatigue).toBeLessThan(80);
    expect(later.health).toBeGreaterThan(50);
    expect(later.form).toBeLessThan(1);
    const much = projectCondition(stored, new Date("2026-02-01T00:00:00Z"), 50, cfg);
    expect(much.fatigue).toBe(0);
    expect(much.health).toBe(100);
  });

  it("never goes backwards in time", () => {
    const earlier = projectCondition(stored, new Date("2025-12-31T00:00:00Z"), 50, cfg);
    expect(earlier.fatigue).toBe(80);
  });

  it("hoursUntilFatigue agrees with projection", () => {
    const h = hoursUntilFatigue(80, 20, 50, cfg);
    const at = projectCondition(stored, new Date(stored.updatedAt.getTime() + h * 3_600_000), 50, cfg);
    expect(at.fatigue).toBeCloseTo(20, 5);
  });

  it("fatigue modifier is 1 when fresh and decreasing", () => {
    expect(fatigueModifier(0)).toBe(1);
    expect(fatigueModifier(50)).toBeLessThan(1);
    expect(fatigueModifier(100)).toBeLessThan(fatigueModifier(50));
  });
});

describe("state machine", () => {
  it("allows legal and rejects illegal transitions", () => {
    expect(canTransition("IDLE", "TRAINING")).toBe(true);
    expect(canTransition("TRAINING", "ENTERED")).toBe(false);
    expect(() => assertTransition("RETIRED", "IDLE")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("ENTERED", "RACING")).not.toThrow();
  });
});

describe("valuation", () => {
  it("values better and younger horses higher and stays positive", async () => {
    const { horseValuation, potentialStars } = await import("./valuation.js");
    const rng = new Rng("val");
    const weak = generateGenome(rng, { quality: 0.1, rarity: "COMMON" }, cfg);
    const strong = generateGenome(rng, { quality: 0.9, rarity: "COMMON" }, cfg);
    const wv = horseValuation(weak, initialAttributes(weak, 3, rng), 3);
    const sv = horseValuation(strong, initialAttributes(strong, 3, rng), 3);
    expect(sv).toBeGreaterThan(wv);
    expect(wv).toBeGreaterThanOrEqual(500);
    expect(potentialStars(strong)).toBeGreaterThan(potentialStars(weak));
  });
});
