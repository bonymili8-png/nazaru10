import type { HorseSummaryDto, StableDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

describe("stable mastery", () => {
  let t: TestApp;
  let token: string;
  let userId: string;
  let horseId: string;
  const mastery = async () => (await t.get<StableDto>("/stable", token)).body.mastery.tracks;

  beforeAll(async () => {
    t = await createTestApp();
    ({ token, userId } = await t.login(9801, "Master"));
    horseId = (await t.get<HorseSummaryDto[]>("/horses", token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("starts at level 0 on every track, with no edge", async () => {
    const tracks = await mastery();
    expect(tracks.map((x) => x.track)).toEqual(["TRAINING", "RACING", "BREEDING"]);
    for (const x of tracks) expect(x).toMatchObject({ xp: 0, level: 0, bonusPct: 0 });
    expect(tracks[0]).toMatchObject({ nextAt: 10, perLevelPct: 1 });
  });

  it("levels up from what the owner did, and the edge reaches new training sessions", async () => {
    // Ten finished sessions of history (the count is what matters, not how they went).
    await t.db.query(
      `INSERT INTO training_sessions (horse_id, owner_id, type, intensity, cost, status, start_state, started_at, completes_at, completed_at)
       SELECT $1, $2, 'SPEED', 'NORMAL', 0, 'COMPLETED', '{}'::jsonb, now() - interval '2 days', now() - interval '1 day', now() - interval '1 day'
         FROM generate_series(1, 10)`,
      [horseId, userId],
    );
    const training = (await mastery())[0]!;
    expect(training).toMatchObject({ xp: 10, level: 1, bonusPct: 1, nextAt: 30 });

    const r = await t.post(`/horses/${horseId}/training`, { type: "SPEED", intensity: "NORMAL" }, token);
    expect(r.status).toBe(201);
    const s = await t.db.one<{ start_state: { mastery?: { gainMultiplier: number } } }>(
      "SELECT start_state FROM training_sessions WHERE horse_id = $1 AND status = 'ACTIVE'",
      [horseId],
    );
    expect(s!.start_state.mastery?.gainMultiplier).toBeCloseTo(1.01);
  });
});
