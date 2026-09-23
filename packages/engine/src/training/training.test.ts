import { describe, expect, it } from "vitest";
import { defaultConfig as cfg, TRAINING_INTENSITIES, TRAINING_TYPES } from "../config/index.js";
import { generateGenome, initialAttributes } from "../horse/generate.js";
import { TRAINABLE_ATTRIBUTES } from "../horse/types.js";
import { Rng } from "../rng.js";
import { resolveTraining, trainingBlockReason, trainingCost } from "./index.js";

describe("training", () => {
  it("never exceeds genetic ceilings, never lowers attributes, keeps condition bounded", () => {
    const rng = new Rng("train-props");
    for (let i = 0; i < 3000; i++) {
      const genome = generateGenome(rng, { quality: rng.next() }, cfg);
      const attributes = initialAttributes(genome, rng.float(1, 9), rng);
      const out = resolveTraining(
        {
          type: rng.pick(TRAINING_TYPES),
          intensity: rng.pick(TRAINING_INTENSITIES),
          attributes,
          genome,
          condition: { fatigue: rng.float(0, 100), health: rng.float(0, 100), form: 0 },
          age: rng.float(1, 9.9),
          sessionsLast24h: rng.int(0, 6),
        },
        rng,
        cfg,
      );
      for (const a of TRAINABLE_ATTRIBUTES) {
        expect(out.attributes[a]).toBeLessThanOrEqual(genome.ceilings[a] + 1e-9);
        expect(out.attributes[a]).toBeGreaterThanOrEqual(attributes[a]);
      }
      expect(out.fatigue).toBeGreaterThanOrEqual(0);
      expect(out.fatigue).toBeLessThanOrEqual(100);
      expect(out.health).toBeGreaterThanOrEqual(0);
      expect(out.health).toBeLessThanOrEqual(100);
      if (out.injury) expect(out.injury.chance).toBeLessThanOrEqual(cfg.training.maxInjuryChance);
    }
  });

  const base = () => {
    const rng = new Rng("base");
    const genome = generateGenome(rng, { quality: 0.6 }, cfg);
    return { genome, attributes: initialAttributes(genome, 2.5, rng) };
  };

  it("diminishes with repetition and fatigue", () => {
    const { genome, attributes } = base();
    const run = (sessionsLast24h: number, fatigue: number) =>
      resolveTraining(
        {
          type: "SPEED",
          intensity: "NORMAL",
          attributes,
          genome,
          condition: { fatigue, health: 100, form: 0 },
          age: 3,
          sessionsLast24h,
        },
        new Rng("same"),
        cfg,
      ).gains.speed ?? 0;
    expect(run(0, 0)).toBeGreaterThan(run(3, 0));
    expect(run(0, 0)).toBeGreaterThan(run(0, 70));
  });

  it("recovery sessions reduce fatigue and never injure", () => {
    const { genome, attributes } = base();
    for (let i = 0; i < 200; i++) {
      const out = resolveTraining(
        {
          type: "RECOVERY",
          intensity: "HARD",
          attributes,
          genome,
          condition: { fatigue: 90, health: 40, form: 0 },
          age: 3,
          sessionsLast24h: 0,
        },
        new Rng(`rec${i}`),
        cfg,
      );
      expect(out.fatigue).toBeLessThan(90);
      expect(out.health).toBeGreaterThan(40);
      expect(out.injury).toBeNull();
    }
  });

  it("hard training on a tired horse injures more often than light training on a fresh one", () => {
    const { genome, attributes } = base();
    const rate = (intensity: "LIGHT" | "HARD", fatigue: number) => {
      let n = 0;
      for (let i = 0; i < 20_000; i++) {
        const out = resolveTraining(
          {
            type: "SPEED",
            intensity,
            attributes,
            genome,
            condition: { fatigue, health: 100, form: 0 },
            age: 3,
            sessionsLast24h: 0,
          },
          new Rng(`inj${intensity}${i}`),
          cfg,
        );
        if (out.injury) n++;
      }
      return n / 20_000;
    };
    expect(rate("HARD", 80)).toBeGreaterThan(rate("LIGHT", 0) * 3);
  });

  it("blocks unsafe training but always allows recovery", () => {
    const tired = { fatigue: 95, health: 100, form: 0 };
    expect(trainingBlockReason(tired, 3, "SPEED", cfg)).toBe("TOO_FATIGUED");
    expect(trainingBlockReason(tired, 3, "RECOVERY", cfg)).toBeNull();
    expect(trainingBlockReason({ fatigue: 0, health: 30, form: 0 }, 3, "SPEED", cfg)).toBe("HEALTH_TOO_LOW");
    expect(trainingBlockReason({ fatigue: 0, health: 100, form: 0 }, 0.5, "SPEED", cfg)).toBe("TOO_YOUNG");
  });

  it("prices intensities consistently", () => {
    expect(trainingCost("SPEED", "HARD", cfg)).toBeGreaterThan(trainingCost("SPEED", "NORMAL", cfg));
    expect(trainingCost("SPEED", "LIGHT", cfg)).toBeLessThan(trainingCost("SPEED", "NORMAL", cfg));
  });
});
