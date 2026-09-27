import type { HorseDetailDto, HorseSummaryDto, StableDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type Err = { error: { code: string } };

describe("paid renames", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let rival: { token: string; userId: string };
  let horse: string;
  let rivalHorse: string;
  const gems = async (u = owner) =>
    (await t.get<{ balances: { GEMS: number } }>("/wallet", u.token)).body.balances.GEMS;
  const fund = (u: { userId: string }, amount: number, key: string) =>
    t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: u.userId,
        currency: "GEMS",
        amount,
        source: "ADMIN_ADJUSTMENT",
        key,
        type: "ADMIN_ADJUSTMENT",
      }),
    );

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(4701, "Renamer");
    rival = await t.login(4702, "Rival");
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
    rivalHorse = (await t.get<HorseSummaryDto[]>("/horses", rival.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("publishes the prices", async () => {
    const s = (await t.get<StableDto>("/stable", owner.token)).body;
    expect(s.renameGems).toEqual({ stable: 80, horse: 50 });
  });

  it("accepts only Latin names of the right length", async () => {
    await fund(owner, 1000, "rn:fund");
    for (const name of ["Буревій", "Ştefan", "A", "x".repeat(25), " -Dash", "Name!", "日本"])
      expect((await t.post(`/horses/${horse}/rename`, { name }, owner.token)).status, name).toBe(400);
    expect((await t.post("/stable/rename", { name: "Зоряна стайня" }, owner.token)).status).toBe(400);
    expect(await gems()).toBe(1000);
  });

  it("renames a horse for gems, tidying whitespace; owner only", async () => {
    expect((await t.post(`/horses/${horse}/rename`, { name: "Night Fury" }, rival.token)).status).toBe(403);
    const r = await t.post<HorseDetailDto>(
      `/horses/${horse}/rename`,
      { name: "  Night   Fury " },
      owner.token,
    );
    expect(r.status).toBe(201);
    expect(r.body.name).toBe("Night Fury");
    expect(await gems()).toBe(950);
    const same = await t.post<Err>(`/horses/${horse}/rename`, { name: "Night Fury" }, owner.token);
    expect(same.body.error.code).toBe("NAME_UNCHANGED");
  });

  it("keeps names unique among active horses and stables (case-insensitive)", async () => {
    await fund(rival, 500, "rn:fund:rival");
    const dup = await t.post<Err>(`/horses/${rivalHorse}/rename`, { name: "night fury" }, rival.token);
    expect(dup.body.error.code).toBe("NAME_TAKEN");
    expect(await gems(rival)).toBe(500);

    const s = await t.post<StableDto>("/stable/rename", { name: "Golden Gate Stud" }, owner.token);
    expect(s.status).toBe(201);
    expect(s.body.name).toBe("Golden Gate Stud");
    expect(await gems()).toBe(870);
    const taken = await t.post<Err>("/stable/rename", { name: "GOLDEN GATE STUD" }, rival.token);
    expect(taken.body.error.code).toBe("NAME_TAKEN");
  });

  it("needs enough gems", async () => {
    const broke = await t.login(4703, "Broke");
    const h = (await t.get<HorseSummaryDto[]>("/horses", broke.token)).body[0]!.id;
    const r = await t.post<Err>(`/horses/${h}/rename`, { name: "Penny Less" }, broke.token);
    expect(r.body.error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
