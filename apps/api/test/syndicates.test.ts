import type { HorseSummaryDto, MyShareDto, ShareOfferDto, SyndicateDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SyndicatesService } from "../src/modules/syndicates/syndicates.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };

describe("syndicates", () => {
  let t: TestApp;
  let manager: User;
  let partner: User;
  let other: User;
  let horseId: string;
  let price: number;
  const cfg = defaultConfig.syndicates;

  const credits = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", u.token)).body.balances.CREDITS;

  beforeAll(async () => {
    t = await createTestApp();
    manager = await t.login(8301, "Manager");
    partner = await t.login(8302, "Partner");
    other = await t.login(8303, "Other");
    for (const u of [manager, partner, other]) await t.giveKeeper(u.userId);
    horseId = (await t.get<HorseSummaryDto[]>("/horses", manager.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("offers shares within the price band and the partner limit", async () => {
    const view = (await t.get<SyndicateDto>(`/syndicates/${horseId}`, manager.token)).body;
    expect(view).toMatchObject({ totalShares: 10, managerShares: 10, partners: [], offer: null });
    const band = view.priceBand!;
    expect(band.min).toBeGreaterThan(0);
    // Others don't see the band.
    expect((await t.get<SyndicateDto>(`/syndicates/${horseId}`, other.token)).body.priceBand).toBeNull();

    const offer = (body: unknown, u = manager) =>
      t.post<{ error: { code: string } }>(`/syndicates/${horseId}/offer`, body, u.token);
    expect((await offer({ shares: 2, pricePerShare: band.max + 1 })).body.error.code).toBe(
      "PRICE_OUT_OF_RANGE",
    );
    expect((await offer({ shares: cfg.maxPartnerShares + 1, pricePerShare: band.min })).body.error.code).toBe(
      "TOO_MANY_SHARES",
    );
    expect((await offer({ shares: 2, pricePerShare: band.min }, other)).status).toBe(403);
    price = Math.min(band.max, Math.max(band.min, 200));
    const ok = await t.post<SyndicateDto>(
      `/syndicates/${horseId}/offer`,
      { shares: 3, pricePerShare: price },
      manager.token,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.offer).toEqual({ pricePerShare: price, available: 3 });
    const listed = (await t.get<ShareOfferDto[]>("/syndicates/offers", other.token)).body;
    expect(listed.map((o) => o.horse.id)).toContain(horseId);
  });

  it("sells shares: buyer pays, manager receives minus the fee, offer shrinks", async () => {
    const [mBefore, pBefore] = [await credits(manager), await credits(partner)];
    expect((await t.post(`/syndicates/${horseId}/buy`, { shares: 1 }, manager.token)).status).toBe(409);
    expect((await t.post(`/syndicates/${horseId}/buy`, { shares: 4 }, partner.token)).status).toBe(409);
    const r = await t.post<SyndicateDto>(`/syndicates/${horseId}/buy`, { shares: 2 }, partner.token);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ myShares: 2, managerShares: 8, offer: { available: 1 } });
    const cost = price * 2;
    expect(await credits(partner)).toBe(pBefore - cost);
    expect(await credits(manager)).toBe(mBefore + cost - Math.floor(cost * cfg.feeRate));
  });

  it("keeps a syndicated horse off the market", async () => {
    const r = await t.post<{ error: { code: string } }>(
      "/market/listings",
      { horseId, type: "FIXED", price: 5000 },
      manager.token,
    );
    expect(r.body.error.code).toBe("SYNDICATED");
  });

  it("splits prize money pro rata and shows partners what they earned", async () => {
    const before = await credits(partner);
    const mBefore = await credits(manager);
    await t.db.tx((c) =>
      t.service(SyndicatesService).splitCredit(c, {
        horseId,
        managerId: manager.userId,
        amount: 1001,
        source: "RACE_PRIZE",
        key: "test:prize:1",
        type: "RACE_PRIZE",
        reason: "Test purse",
        metadata: { raceId: "test", horseId },
      }),
    );
    expect(await credits(partner)).toBe(before + 200);
    expect(await credits(manager)).toBe(mBefore + 801);
    const mine = (await t.get<MyShareDto[]>("/syndicates/mine", partner.token)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ shares: 2, costPaid: price * 2, earned: 200 });
    expect(mine[0]!.horse.id).toBe(horseId);
  });

  it("dissolves by buying every share back at cost, freeing the horse", async () => {
    const pBefore = await credits(partner);
    expect((await t.post(`/syndicates/${horseId}/dissolve`, {}, partner.token)).status).toBe(403);
    const r = await t.post<SyndicateDto>(`/syndicates/${horseId}/dissolve`, {}, manager.token);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ partners: [], managerShares: 10, offer: null });
    expect(await credits(partner)).toBe(pBefore + price * 2);
    expect((await t.get<MyShareDto[]>("/syndicates/mine", partner.token)).body).toEqual([]);
    const listing = await t.post("/market/listings", { horseId, type: "FIXED", price: 5000 }, manager.token);
    expect(listing.status).toBe(201);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
