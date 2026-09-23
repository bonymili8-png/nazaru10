import { describe, expect, it } from "vitest";
import { mean, stdDev } from "./math.js";
import { Rng } from "./rng.js";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng("seed");
    const b = new Rng("seed");
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
  });

  it("differs across seeds and forks", () => {
    const a = new Rng("seed");
    expect(new Rng("seed2").next()).not.toBe(a.next());
    expect(a.fork("x").next()).not.toBe(a.fork("y").next());
    expect(a.fork("x").next()).toBe(new Rng("seed").fork("x").next());
  });

  it("int stays within inclusive bounds and hits both ends", () => {
    const r = new Rng("int");
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
    expect(() => r.int(5, 1)).toThrow(RangeError);
  });

  it("is roughly uniform (chi-square, 10 buckets)", () => {
    const r = new Rng("uniform");
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]!++;
    const expected = n / 10;
    const chi = buckets.reduce((s, b) => s + (b - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(27.9); // p ≈ 0.001 for 9 dof
  });

  it("produces normals with the requested moments", () => {
    const r = new Rng("normal");
    const xs = Array.from({ length: 50_000 }, () => r.normal(10, 2));
    expect(mean(xs)).toBeCloseTo(10, 1);
    expect(stdDev(xs)).toBeCloseTo(2, 1);
  });

  it("weighted pick respects weights", () => {
    const r = new Rng("w");
    let a = 0;
    for (let i = 0; i < 20_000; i++)
      if (
        r.weighted([
          ["a", 3],
          ["b", 1],
        ] as const) === "a"
      )
        a++;
    expect(a / 20_000).toBeGreaterThan(0.72);
    expect(a / 20_000).toBeLessThan(0.78);
  });
});
