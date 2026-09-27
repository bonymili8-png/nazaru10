import type { HorseAdviceDto, HorseSummaryDto, RaceDetailDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("trainer's advice", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let rival: { token: string; userId: string };
  let horse: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(4601, "Mentor");
    rival = await t.login(4602, "Nosy");
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
    await t.service(RaceRunnerService).scheduleAhead();
  });
  afterAll(() => t.close());

  it("is for the owner only", async () => {
    expect((await t.get(`/horses/${horse}/advice`, rival.token)).status).toBe(403);
  });

  it("suggests a training session and open races the horse can actually enter", async () => {
    const a = (await t.get<HorseAdviceDto>(`/horses/${horse}/advice`, owner.token)).body;
    expect(["SPRINTER", "MILER", "STAYER"]).toContain(a.profile);
    expect(a.training.type).not.toBe("RECOVERY");
    expect(a.restHours).toBe(0);
    expect(a.races.length).toBeGreaterThan(0);
    expect(a.races.length).toBeLessThanOrEqual(3);
    // A new horse has no wins and a 1000 rating: maiden races and Class 5 only.
    for (const r of a.races) expect(["MAIDEN", "CLASS_5"]).toContain(r.class);

    // Entering the first suggestion works, and it is no longer suggested.
    const first = a.races[0]!;
    const e = await t.post<RaceDetailDto>(
      `/races/${first.id}/entries`,
      { horseId: horse, strategy: "MID_PACK" },
      owner.token,
    );
    expect(e.status).toBe(201);
    const again = (await t.get<HorseAdviceDto>(`/horses/${horse}/advice`, owner.token)).body;
    expect(again.races.some((r) => r.id === first.id)).toBe(false);
  });

  it("leaves maiden races out once the horse has won", async () => {
    await t.db.query("UPDATE horses SET wins = 1, starts = 1, status = 'IDLE' WHERE id = $1", [horse]);
    const a = (await t.get<HorseAdviceDto>(`/horses/${horse}/advice`, owner.token)).body;
    expect(a.races.every((r) => r.class === "CLASS_5")).toBe(true);
  });
});
