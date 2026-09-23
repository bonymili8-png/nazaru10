import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { generateGenome, initialAttributes } from "../horse/generate.js";
import { Rng } from "../rng.js";
import { resolveTraining } from "../training/index.js";
import {
  generateTrainer as gen,
  bestTrainerFor,
  maxTrainers,
  trainerEffect,
  trainerSalary,
} from "./index.js";

describe("staff", () => {
  it("generates trainers within the configured band, mostly journeymen", () => {
    const rng = new Rng("trainers");
    const list = Array.from({ length: 2000 }, () => gen(rng, cfg));
    for (const t of list) {
      expect(t.skill).toBeGreaterThanOrEqual(cfg.staff.minSkill);
      expect(t.skill).toBeLessThanOrEqual(cfg.staff.maxSkill);
      expect(t.specialty).not.toBe("RECOVERY");
    }
    const masters = list.filter((t) => t.skill >= 85).length / list.length;
    expect(masters).toBeGreaterThan(0.02);
    expect(masters).toBeLessThan(0.2);
  });

  it("prices skill progressively and never below the base", () => {
    let prev = 0;
    for (let skill = cfg.staff.minSkill; skill <= cfg.staff.maxSkill; skill += 5) {
      const s = trainerSalary(skill, cfg);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(trainerSalary(cfg.staff.minSkill, cfg)).toBe(cfg.staff.salaryBase);
  });

  it("gives bounded, specialty-weighted effects and picks the best trainer per session", () => {
    const top = trainerEffect({ skill: 95, specialty: "SPEED" }, "SPEED", cfg);
    expect(top.gainMultiplier).toBeLessThan(1.25);
    expect(top.injuryMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(trainerEffect({ skill: 40, specialty: null }, "SPEED", cfg)).toEqual({
      gainMultiplier: 1,
      injuryMultiplier: 1,
    });
    const staff = [
      { skill: 70, specialty: null },
      { skill: 60, specialty: "STAMINA" as const },
    ];
    expect(bestTrainerFor(staff, "STAMINA", cfg)?.trainer.skill).toBe(60);
    expect(bestTrainerFor(staff, "SPEED", cfg)?.trainer.skill).toBe(70);
    expect(bestTrainerFor([], "SPEED", cfg)).toBeNull();
    expect(maxTrainers(1, cfg)).toBe(1);
    expect(maxTrainers(99, cfg)).toBe(cfg.staff.maxTrainers.at(-1));
  });

  it("scales training gains through the engine", () => {
    const rng = new Rng("coached");
    const genome = generateGenome(rng, { quality: 0.6 }, cfg);
    const base = {
      type: "SPEED" as const,
      intensity: "NORMAL" as const,
      attributes: initialAttributes(genome, 2.5, rng),
      genome,
      condition: { fatigue: 10, health: 100, form: 0 },
      age: 3,
      sessionsLast24h: 0,
    };
    const plain = resolveTraining(base, new Rng("s"), cfg);
    const coached = resolveTraining({ ...base, trainerMultiplier: 1.1 }, new Rng("s"), cfg);
    expect(coached.gains.speed!).toBeCloseTo(plain.gains.speed! * 1.1, 1);
  });
});
