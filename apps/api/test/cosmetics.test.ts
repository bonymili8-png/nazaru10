import type { CosmeticsDto, HorseSummaryDto, RaceDetailDto, RaceSummaryDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("cosmetics — racing silks", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  const price = defaultConfig.cosmetics.silkPatternPrices.HOOPS!;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(9971, "Silky");
  });
  afterAll(() => t.close());

  it("starts with free solid silks and every other pattern locked", async () => {
    const c = (await t.get<CosmeticsDto>("/cosmetics", owner.token)).body;
    expect(c.silks).toEqual({ pattern: "SOLID", primary: "gold", secondary: "black" });
    expect(c.patterns.find((p) => p.pattern === "SOLID")).toMatchObject({ owned: true, priceGems: 0 });
    expect(c.patterns.filter((p) => p.owned)).toHaveLength(1);
  });

  it("refuses locked patterns, unknown colours and matching colours", async () => {
    const set = (body: unknown) => t.put("/cosmetics/silks", body, owner.token);
    expect((await set({ pattern: "HOOPS", primary: "royal", secondary: "white" })).status).toBe(409);
    expect((await set({ pattern: "SOLID", primary: "rainbow", secondary: "white" })).status).toBe(400);
    expect((await set({ pattern: "SOLID", primary: "white", secondary: "white" })).status).toBe(400);
    expect((await t.post("/cosmetics/silks/patterns/HOOPS/unlock", {}, owner.token)).status).toBe(409);
  });

  it("unlocks a pattern for gems exactly once, then wears it", async () => {
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount: 500,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:silky",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    const r = await t.post<CosmeticsDto>("/cosmetics/silks/patterns/HOOPS/unlock", {}, owner.token);
    expect(r.status).toBe(201);
    expect(r.body.gems).toBe(500 - price);
    expect(r.body.patterns.find((p) => p.pattern === "HOOPS")?.owned).toBe(true);
    expect((await t.post("/cosmetics/silks/patterns/HOOPS/unlock", {}, owner.token)).status).toBe(409);
    const set = await t.put<CosmeticsDto>(
      "/cosmetics/silks",
      { pattern: "HOOPS", primary: "royal", secondary: "white" },
      owner.token,
    );
    expect(set.status).toBe(200);
    expect(set.body.silks).toEqual({ pattern: "HOOPS", primary: "royal", secondary: "white" });
  });

  it("shows the owner's silks on race cards (house runners have none)", async () => {
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN", owner.token)).body[0]!;
    const horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!;
    await t.post(`/races/${race.id}/entries`, { horseId: horse.id, strategy: "MID_PACK" }, owner.token);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    const d = (await t.get<RaceDetailDto>(`/races/${race.id}`, owner.token)).body;
    expect(d.entryList.find((e) => e.mine)?.silks).toEqual({
      pattern: "HOOPS",
      primary: "royal",
      secondary: "white",
    });
    expect(d.entryList.filter((e) => e.isHouse).every((e) => e.silks === null)).toBe(true);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
