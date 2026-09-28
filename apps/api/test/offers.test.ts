import type { HorseDetailDto, HorseOfferDto, HorseSummaryDto, OffersDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { OffersService } from "../src/modules/market/offers.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type Err = { error: { code: string } };
type U = { token: string; userId: string };

describe("offers on horses not for sale", () => {
  const keepers = new Map<string, string>();
  let t: TestApp;
  let seller: U;
  let buyer: U;
  let rival: U;
  let horse: string;
  let band: { min: number; max: number };
  const credits = async (u: U) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", u.token)).body.balances.CREDITS;
  const fund = (u: U, amount: number) =>
    t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: u.userId,
        currency: "CREDITS",
        amount,
        source: "ADMIN_ADJUSTMENT",
        key: `fund:${u.userId}:${amount}:${Math.random()}`,
        type: "TEST",
      }),
    );
  const offer = (u: U, amount: number) =>
    t.post<HorseOfferDto & Err>(`/horses/${horse}/offers`, { amount }, u.token);

  beforeAll(async () => {
    t = await createTestApp();
    seller = await t.login(5001, "Seller");
    buyer = await t.login(5002, "Buyer");
    rival = await t.login(5003, "Rival");
    for (const u of [seller, buyer, rival]) keepers.set(u.userId, await t.giveKeeper(u.userId));
    horse = (await t.get<HorseSummaryDto[]>("/horses", seller.token)).body[0]!.id;
    await fund(buyer, 100_000);
    await fund(rival, 100_000);
    // Room for one more horse in each buyer's stable.
    await t.db.query("UPDATE stables SET level = 2 WHERE owner_id = ANY($1::uuid[])", [
      [buyer.userId, rival.userId],
    ]);
  });
  afterAll(() => t.close());

  it("shows the allowed band to others, not to the owner", async () => {
    expect((await t.get<HorseDetailDto>(`/horses/${horse}`, seller.token)).body.offerBand).toBeNull();
    band = (await t.get<HorseDetailDto>(`/horses/${horse}`, buyer.token)).body.offerBand!;
    expect(band.min).toBeGreaterThan(0);
    expect(band.max).toBeGreaterThan(band.min);
  });

  it("escrows the amount, one open offer per buyer, within the band", async () => {
    expect((await offer(buyer, band.min - 1)).body.error.code).toBe("PRICE_OUT_OF_BAND");
    expect((await offer(seller, band.min)).body.error.code).toBe("SELF_TRADE");
    const before = await credits(buyer);
    const o = await offer(buyer, band.min + 100);
    expect(o.status).toBe(201);
    expect(o.body.status).toBe("OPEN");
    expect(await credits(buyer)).toBe(before - (band.min + 100));
    expect((await offer(buyer, band.min + 200)).body.error.code).toBe("OFFER_EXISTS");

    const received = (await t.get<OffersDto>("/market/offers", seller.token)).body.received;
    expect(received.map((x) => x.id)).toEqual([o.body.id]);
    const ev = await t.db.query("SELECT 1 FROM domain_events WHERE type = 'offer_received'");
    expect(ev).toHaveLength(1);
  });

  it("returns the escrow when the buyer withdraws or the owner declines", async () => {
    const mine = (await t.get<OffersDto>("/market/offers", buyer.token)).body.made[0]!;
    expect((await t.post(`/market/offers/${mine.id}/accept`, {}, buyer.token)).status).toBe(403);
    const before = await credits(buyer);
    const w = await t.post<HorseOfferDto>(`/market/offers/${mine.id}/withdraw`, {}, buyer.token);
    expect(w.body.status).toBe("WITHDRAWN");
    expect(await credits(buyer)).toBe(before + mine.amount);

    const again = await offer(buyer, band.min + 50);
    const d = await t.post<HorseOfferDto>(`/market/offers/${again.body.id}/decline`, {}, seller.token);
    expect(d.body.status).toBe("DECLINED");
    expect(await credits(buyer)).toBe(before + mine.amount);
  });

  it("will not let the owner accept an offer for their last horse", async () => {
    const keeper = keepers.get(seller.userId)!;
    await t.db.query("UPDATE horses SET retired_at = now() WHERE id = $1", [keeper]);
    const o = await offer(buyer, band.min + 50);
    const a = await t.post<{ error: { code: string } }>(`/market/offers/${o.body.id}/accept`, {}, seller.token);
    expect(a.body.error.code).toBe("LAST_HORSE");
    await t.db.query("UPDATE horses SET retired_at = NULL WHERE id = $1", [keeper]);
    expect((await t.post(`/market/offers/${o.body.id}/withdraw`, {}, buyer.token)).status).toBe(201);
  });

  it("sells the horse on accept, pays the seller net of fee and refunds rival offers", async () => {
    const buyerBefore = await credits(buyer);
    const rivalBefore = await credits(rival);
    const sellerBefore = await credits(seller);
    const amount = band.min + 500;
    const o = await offer(buyer, amount);
    await offer(rival, band.min + 300);
    const a = await t.post<HorseOfferDto>(`/market/offers/${o.body.id}/accept`, {}, seller.token);
    expect(a.status).toBe(201);
    expect(a.body.status).toBe("ACCEPTED");
    const fee = Math.round(amount * defaultConfig.market.saleFeeRate);
    expect(await credits(seller)).toBe(sellerBefore + amount - fee);
    expect(await credits(buyer)).toBe(buyerBefore - amount);
    expect(await credits(rival)).toBe(rivalBefore);
    const owner = (
      await t.db.query<{ owner_id: string }>("SELECT owner_id FROM horses WHERE id = $1", [horse])
    )[0]!;
    expect(owner.owner_id).toBe(buyer.userId);
    const rivals = (await t.get<OffersDto>("/market/offers", rival.token)).body.made[0]!;
    expect(rivals.status).toBe("EXPIRED");
  });

  it("expires unanswered offers and returns the escrow", async () => {
    // The new owner gets an offer from the rival, and lets it lapse.
    const before = await credits(rival);
    const o = await offer(rival, band.min + 10);
    expect(o.status).toBe(201);
    t.clock.advance((defaultConfig.market.offerHours + 1) * 3_600_000);
    expect(await t.service(OffersService).expireDue()).toBeGreaterThanOrEqual(1);
    expect(await credits(rival)).toBe(before);
    const late = await t.post<Err>(`/market/offers/${o.body.id}/accept`, {}, buyer.token);
    expect(late.body.error.code).toBe("OFFER_CLOSED");
  });

  it("keeps the ledger balanced with an empty escrow", async () => {
    await assertLedgerIntegrity(t.db);
    const escrow = await t.db.query<{ balance: string }>(
      "SELECT balance FROM accounts WHERE owner_type = 'ESCROW' AND currency = 'CREDITS'",
    );
    expect(escrow).toHaveLength(1);
    expect(Number(escrow[0]!.balance)).toBe(0);
  });
});
