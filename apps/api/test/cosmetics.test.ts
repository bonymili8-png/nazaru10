import {
  type CosmeticsDto,
  DEFAULT_CREST,
  type HorseSummaryDto,
  type LeaderboardOwnerDto,
  type RaceDetailDto,
  type RaceSummaryDto,
  type StableDto,
} from "@thoroughline/contracts";
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

describe("cosmetics — stable crest", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  const crown = defaultConfig.cosmetics.crestIconPrices.CROWN!;
  const gems = (amount: number, key: string) =>
    t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount,
        source: "ADMIN_ADJUSTMENT",
        key,
        type: "ADMIN_ADJUSTMENT",
      }),
    );

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(9981, "Herald");
  });
  afterAll(() => t.close());

  it("starts with the default crest; free emblems are owned, the rest cost gems", async () => {
    const c = (await t.get<CosmeticsDto>("/cosmetics", owner.token)).body;
    expect(c.crest).toEqual(DEFAULT_CREST);
    const free = c.crestIcons.filter((i) => i.priceGems === 0).map((i) => i.icon);
    expect(free).toEqual(["HORSESHOE", "STAR", "CRESCENT"]);
    expect(c.crestIcons.every((i) => i.owned === (i.priceGems === 0))).toBe(true);
    expect((await t.get<StableDto>("/stable", owner.token)).body.crest).toEqual(DEFAULT_CREST);
  });

  it("changes shape and colours freely but refuses a locked emblem or matching colours", async () => {
    const set = (body: unknown) => t.put<CosmeticsDto>("/cosmetics/crest", body, owner.token);
    const ok = await set({ shape: "DIAMOND", icon: "STAR", field: "navy", charge: "white" });
    expect(ok.status).toBe(200);
    expect(ok.body.crest).toEqual({ shape: "DIAMOND", icon: "STAR", field: "navy", charge: "white" });
    expect((await set({ shape: "ROUND", icon: "CROWN", field: "navy", charge: "gold" })).status).toBe(409);
    expect((await set({ shape: "ROUND", icon: "STAR", field: "gold", charge: "gold" })).status).toBe(400);
    expect((await set({ shape: "OVAL", icon: "STAR", field: "navy", charge: "gold" })).status).toBe(400);
    expect((await t.post("/cosmetics/crest/icons/CROWN/unlock", {}, owner.token)).status).toBe(409);
  });

  it("unlocks an emblem once for gems and shows the crest in the rankings", async () => {
    await gems(200, "test:gems:herald");
    const r = await t.post<CosmeticsDto>("/cosmetics/crest/icons/CROWN/unlock", {}, owner.token);
    expect(r.status).toBe(201);
    expect(r.body.gems).toBe(200 - crown);
    expect((await t.post("/cosmetics/crest/icons/CROWN/unlock", {}, owner.token)).status).toBe(409);
    // Free emblems never charge.
    expect(
      (await t.post<CosmeticsDto>("/cosmetics/crest/icons/STAR/unlock", {}, owner.token)).body.gems,
    ).toBe(200 - crown);
    const crest = { shape: "BANNER", icon: "CROWN", field: "scarlet", charge: "gold" } as const;
    expect((await t.put("/cosmetics/crest", crest, owner.token)).status).toBe(200);

    const board = (await t.get<LeaderboardOwnerDto[]>("/leaderboard/owners?by=rating", owner.token)).body;
    expect(board.find((o) => o.userId === owner.userId)?.crest).toEqual(crest);
    expect((await t.get<StableDto>("/stable", owner.token)).body.crest).toEqual(crest);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});

describe("cosmetics — saddle cloths", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let other: { token: string; userId: string };
  const stripe = defaultConfig.cosmetics.clothPatternPrices.STRIPE!;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(9991, "Tailor");
    other = await t.login(9992, "Rival");
  });
  afterAll(() => t.close());

  it("dresses the owner's horse (plain is free) and shows it on the horse and race card", async () => {
    const horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!;
    expect(horse.cloth).toBeNull();
    const cloth = { pattern: "PLAIN", color: "royal", trim: "gold" } as const;
    const r = await t.put(`/cosmetics/horses/${horse.id}/cloth`, cloth, owner.token);
    expect(r.status).toBe(200);
    expect((await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.cloth).toEqual(cloth);

    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN", owner.token)).body[0]!;
    await t.post(`/races/${race.id}/entries`, { horseId: horse.id, strategy: "MID_PACK" }, owner.token);
    const detail = (await t.get<RaceDetailDto>(`/races/${race.id}`, other.token)).body;
    expect(detail.entryList.find((e) => e.horseId === horse.id)?.cloth).toEqual(cloth);
  });

  it("refuses other owners' horses, locked patterns and matching colours", async () => {
    const horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!;
    const put = (body: unknown, token = owner.token) =>
      t.put(`/cosmetics/horses/${horse.id}/cloth`, body, token);
    expect((await put({ pattern: "PLAIN", color: "pink", trim: "white" }, other.token)).status).toBe(404);
    expect((await put({ pattern: "STRIPE", color: "pink", trim: "white" })).status).toBe(409);
    expect((await put({ pattern: "PLAIN", color: "pink", trim: "pink" })).status).toBe(400);
    expect((await t.put(`/cosmetics/horses/not-a-uuid/cloth`, {}, owner.token)).status).toBe(400);
  });

  it("unlocks a pattern once for the whole stable", async () => {
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount: 100,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:tailor",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    const r = await t.post<CosmeticsDto>("/cosmetics/cloth/patterns/STRIPE/unlock", {}, owner.token);
    expect(r.status).toBe(201);
    expect(r.body.gems).toBe(100 - stripe);
    expect(r.body.clothPatterns.find((p) => p.pattern === "STRIPE")?.owned).toBe(true);
    expect((await t.post("/cosmetics/cloth/patterns/STRIPE/unlock", {}, owner.token)).status).toBe(409);
    const horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!;
    const ok = await t.put(
      `/cosmetics/horses/${horse.id}/cloth`,
      { pattern: "STRIPE", color: "emerald", trim: "white" },
      owner.token,
    );
    expect(ok.status).toBe(200);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
