import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { generateGenome } from "../horse/generate.js";
import { TRAINABLE_ATTRIBUTES } from "../horse/types.js";
import { slope } from "../math.js";
import { Rng } from "../rng.js";
import { breed, inbreedingCoefficient, type Ancestry } from "./index.js";

describe("inbreeding coefficient", () => {
  const ancestry: Ancestry = new Map([
    ["kid", { sireId: "sire", damId: "dam" }],
    ["kid2", { sireId: "sire", damId: "dam" }],
    ["sire", { sireId: null, damId: null }],
    ["dam", { sireId: null, damId: null }],
  ]);
  it("is 0 for unrelated parents", () => expect(inbreedingCoefficient("sire", "dam", ancestry, 4)).toBe(0));
  it("is 0.25 for parent × offspring", () =>
    expect(inbreedingCoefficient("sire", "kid", ancestry, 4)).toBeCloseTo(0.25));
  it("is 0.25 for full siblings", () =>
    expect(inbreedingCoefficient("kid", "kid2", ancestry, 4)).toBeCloseTo(0.25));
});

describe("breeding", () => {
  it("rejects self-breeding", () => {
    const g = generateGenome(new Rng("x"), { quality: 0.5 }, cfg);
    expect(() =>
      breed({ id: "a", genome: g }, { id: "a", genome: g }, new Map(), new Rng("x"), cfg),
    ).toThrow();
  });

  it("heritability and mutation rate match configuration", () => {
    const rng = new Rng("herit");
    const mids: number[] = [];
    const foals: number[] = [];
    let mutations = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const s = generateGenome(rng, { quality: rng.next() }, cfg);
      const d = generateGenome(rng, { quality: rng.next() }, cfg);
      const out = breed({ id: `s${i}`, genome: s }, { id: `d${i}`, genome: d }, new Map(), rng, cfg);
      if (out.mutation) mutations++;
      else {
        mids.push((s.ceilings.speed + d.ceilings.speed) / 2);
        foals.push(out.genome.ceilings.speed);
      }
      for (const a of TRAINABLE_ATTRIBUTES) {
        expect(out.genome.ceilings[a]).toBeGreaterThanOrEqual(20);
        expect(out.genome.ceilings[a]).toBeLessThanOrEqual(99);
      }
    }
    expect(slope(mids, foals)).toBeGreaterThan(cfg.breeding.heritability - 0.05);
    expect(slope(mids, foals)).toBeLessThan(cfg.breeding.heritability + 0.05);
    expect(mutations / n).toBeGreaterThan(0.007);
    expect(mutations / n).toBeLessThan(0.013);
  });

  it("inbred foals are penalised", () => {
    const rng = new Rng("inb");
    const s = generateGenome(rng, { quality: 0.7 }, cfg);
    const d = generateGenome(rng, { quality: 0.7 }, cfg);
    const anc: Ancestry = new Map([["d", { sireId: "s", damId: null }]]);
    let related = 0;
    let unrelated = 0;
    for (let i = 0; i < 2000; i++) {
      related += breed({ id: "s", genome: s }, { id: "d", genome: d }, anc, new Rng(`r${i}`), cfg).genome
        .ceilings.stamina;
      unrelated += breed({ id: "s", genome: s }, { id: "d", genome: d }, new Map(), new Rng(`r${i}`), cfg)
        .genome.ceilings.stamina;
    }
    expect(related / 2000).toBeLessThan(unrelated / 2000 - 5);
  });
});
