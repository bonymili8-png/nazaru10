import type { HorseSummaryDto, StableDto, TrainingSessionDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("stable facilities", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  const credits = async () =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", owner.token)).body.balances.CREDITS;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(9701, "Builder");
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "CREDITS",
        amount: 50_000,
        source: "ADMIN_ADJUSTMENT",
        key: "test:fund:builder",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
  });
  afterAll(() => t.close());

  it("lists facilities and requires the stable level first", async () => {
    const s = (await t.get<StableDto>("/stable", owner.token)).body;
    expect(s.facilities.map((f) => f.type)).toEqual(["TRAINING_TRACK", "VET_CLINIC"]);
    expect(s.facilities[0]).toMatchObject({ level: 0, maxLevel: 3, requiresStableLevel: 2 });
    const r = await t.post<{ error: { code: string } }>("/stable/facilities/TRAINING_TRACK", {}, owner.token);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("STABLE_LEVEL_TOO_LOW");
    expect((await t.post("/stable/facilities/SWIMMING_POOL", {}, owner.token)).status).toBe(400);
  });

  it("builds a level, charging its cost once", async () => {
    expect((await t.post("/stable/upgrade", {}, owner.token)).status).toBe(201);
    const before = await credits();
    const r = await t.post<StableDto>("/stable/facilities/TRAINING_TRACK", {}, owner.token);
    expect(r.status).toBe(201);
    const track = r.body.facilities.find((f) => f.type === "TRAINING_TRACK")!;
    expect(track).toMatchObject({ level: 1, gainPct: 4, requiresStableLevel: 3 });
    expect(await credits()).toBe(before - defaultConfig.facilities.TRAINING_TRACK.costs[0]!);
    // Level 2 needs stable level 3.
    expect((await t.post("/stable/facilities/TRAINING_TRACK", {}, owner.token)).status).toBe(409);
  });

  it("applies to training sessions started afterwards", async () => {
    const horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!;
    const s = await t.post<TrainingSessionDto>(
      `/horses/${horse.id}/training`,
      { type: "SPEED", intensity: "LIGHT" },
      owner.token,
    );
    expect(s.status).toBe(201);
    const row = await t.db.one<{ start_state: { facilities: { gainMultiplier: number } } }>(
      "SELECT start_state FROM training_sessions WHERE id = $1",
      [s.body.id],
    );
    expect(row!.start_state.facilities.gainMultiplier).toBeCloseTo(1.04, 5);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
