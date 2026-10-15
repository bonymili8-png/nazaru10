import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { scoreTip, tipsterWeek, tipValues } from "./index.js";

describe("tipster league", () => {
  const field = [
    { id: "fav", strength: 55 },
    { id: "mid", strength: 45 },
    { id: "out", strength: 30 },
    { id: "rag", strength: 25 },
  ];

  it("outsiders are worth more than the favourite, within bounds", () => {
    const v = tipValues(field, cfg);
    expect(v.get("fav")!).toBeLessThan(v.get("mid")!);
    expect(v.get("mid")!).toBeLessThan(v.get("out")!);
    for (const x of v.values()) {
      expect(x).toBeGreaterThanOrEqual(cfg.tipster.minValue);
      expect(x).toBeLessThanOrEqual(cfg.tipster.maxValue);
    }
  });

  it("scores the winner by its value, places by slot, and the exact order with a bonus", () => {
    const v = tipValues(field, cfg);
    const pos = new Map([
      ["out", 1],
      ["fav", 2],
      ["mid", 3],
      ["rag", 4],
    ]);
    expect(scoreTip(["out", "fav", "mid"], pos, v, cfg)).toEqual({
      points: v.get("out")! + 5 + 5 + 10,
      slots: [v.get("out")!, 5, 5],
      tricast: 10,
    });
    // Winner wrong but in the first three; the others swapped.
    expect(scoreTip(["fav", "mid", "out"], pos, v, cfg).points).toBe(2 + 2 + 2);
    // A pick that did not run scores nothing.
    expect(scoreTip(["ghost"], pos, v, cfg).points).toBe(0);
  });

  it("weeks start on Monday, UTC", () => {
    expect(tipsterWeek(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(tipsterWeek(new Date("2026-10-12T00:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(tipsterWeek(new Date("2026-10-18T23:59:59Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});
