import type { HorseDetailDto, HorseSummaryDto, OwnerCardDto, PublicStableDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("other owners: search, stables, scouting", () => {
  let t: TestApp;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };
  let aliceHorse: string;
  const gems = async (token: string) =>
    (await t.get<{ balances: { GEMS: number } }>("/wallet", token)).body.balances.GEMS;

  beforeAll(async () => {
    t = await createTestApp();
    alice = await t.login(9861, "Alicia");
    bob = await t.login(9862, "Bobby");
    aliceHorse = (await t.get<HorseSummaryDto[]>("/horses", alice.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("finds owners by name, literally", async () => {
    const r = await t.get<OwnerCardDto[]>("/owners?q=alic", bob.token);
    expect(r.status).toBe(200);
    expect(r.body.map((o) => o.userId)).toContain(alice.userId);
    expect(r.body.find((o) => o.userId === alice.userId)).toMatchObject({ horses: 1, level: 1 });
    expect((await t.get<OwnerCardDto[]>("/owners?q=%25%25", bob.token)).body).toEqual([]);
    expect((await t.get("/owners?q=a", bob.token)).status).toBe(400);
  });

  it("anyone can look round a stable: ratings, attributes and an offer band", async () => {
    const r = await t.get<PublicStableDto>(`/owners/${alice.userId}`, bob.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ userId: alice.userId, isMe: false, level: 1 });
    expect(r.body.horses).toHaveLength(1);
    const h = r.body.horses[0]!;
    expect(h.id).toBe(aliceHorse);
    expect(Object.keys(h.attributes).length).toBeGreaterThan(4);
    expect(h.offerBand!.max).toBeGreaterThan(h.offerBand!.min);
    const own = (await t.get<PublicStableDto>(`/owners/${alice.userId}`, alice.token)).body;
    expect(own.isMe).toBe(true);
    expect(own.horses[0]!.offerBand).toBeNull();
    expect((await t.get(`/owners/00000000-0000-0000-0000-000000000000`, bob.token)).status).toBe(404);
  });

  it("another owner's horse shows attributes; its potential is a paid scouting report", async () => {
    const seen = (await t.get<HorseDetailDto>(`/horses/${aliceHorse}`, bob.token)).body;
    expect(seen.private).toBeNull();
    expect(seen.public!.attributes).toBeTruthy();
    expect(seen.public!.scouting).toEqual({ priceGems: defaultConfig.economy.scoutReportGems, report: null });
    expect((await t.get<HorseDetailDto>(`/horses/${aliceHorse}`, alice.token)).body.public).toBeNull();

    expect((await t.post(`/horses/${aliceHorse}/scout`, {}, bob.token)).status).toBe(409); // no gems
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: bob.userId,
        currency: "GEMS",
        amount: 300,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:bobby",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    const res = await t.post<HorseDetailDto>(`/horses/${aliceHorse}/scout`, {}, bob.token);
    expect(res.status).toBe(201);
    const report = res.body.public!.scouting!.report!;
    expect(report.potentialStars).toBeGreaterThanOrEqual(1);
    expect(Object.keys(report.ceilings).length).toBeGreaterThan(4);
    expect(await gems(bob.token)).toBe(0);
    // Bought once, kept: no second charge.
    expect((await t.post(`/horses/${aliceHorse}/scout`, {}, bob.token)).status).toBe(201);
    expect(
      (await t.post<{ error: { code: string } }>(`/horses/${aliceHorse}/scout`, {}, alice.token)).body.error
        .code,
    ).toBe("OWN_HORSE");
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
