import { describe, expect, it } from "vitest";
import { defaultConfig as cfg } from "../config/index.js";
import { Rng } from "../rng.js";
import { raceReport } from "./report.js";
import { simulateRace } from "./simulate.js";
import { TRACKS } from "./track.js";
import { randomEntrant } from "./validation.js";

describe("race report", () => {
  const rng = new Rng("report");
  const field = Array.from({ length: 8 }, (_, i) => randomEntrant(rng, `h${i}`, 0.5, cfg));
  const distance = 1600;
  const res = simulateRace(
    field,
    { distance, track: TRACKS[0]!, weather: "SUNNY", wetness: 0 },
    "seed-1",
    cfg,
  );

  it("matches the official result and the recorded events", () => {
    for (const r of res.results) {
      const rep = raceReport(res.frames, res.events, r.entrantId, {
        distance,
        fatigueAtStart: 0,
        optimalDistance: distance,
        position: r.position,
      });
      expect(rep.positions).toHaveLength(4);
      expect(rep.positions[3]).toBe(r.position);
      expect(rep.positions.every((p) => p >= 1 && p <= 8)).toBe(true);
      expect(rep.sectionals).toHaveLength(4);
      for (const s of rep.sectionals) {
        expect(s.mine).toBeGreaterThan(0);
        expect(s.mine).toBeGreaterThanOrEqual(s.best);
      }
      const total = rep.sectionals.reduce((sum, s) => sum + s.mine, 0);
      // Frames are 1 s apart, so interpolated splits agree with the official time to within a frame.
      expect(Math.abs(total - r.time)).toBeLessThan(1);
      expect(rep.energyAtFinish).toBeGreaterThanOrEqual(0);
      expect(rep.blockedCount).toBe(
        res.events.filter((e) => e.type === "BLOCKED" && e.horseId === r.entrantId).length,
      );
    }
  });

  it("flags a tired horse and a trip far from its best distance", () => {
    const id = res.results[0]!.entrantId;
    const rep = raceReport(res.frames, res.events, id, {
      distance,
      fatigueAtStart: 45,
      optimalDistance: 2400,
      position: 1,
    });
    expect(rep.insights).toContain("RAN_TIRED");
    expect(rep.insights).toContain("OFF_DISTANCE");
    expect(() =>
      raceReport(res.frames, res.events, "nobody", {
        distance,
        fatigueAtStart: 0,
        optimalDistance: 1,
        position: 1,
      }),
    ).toThrow();
  });
});
