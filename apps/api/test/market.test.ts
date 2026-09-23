import type {
  HorseSummaryDto,
  MarketListingDetailDto,
  MarketListingDto,
  MarketMineDto,
} from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { MarketService } from "../src/modules/market/market.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };

describe("player market", () => {
  let t: TestApp;
  let seller: User;
  const buyers: User[] = [];
  const credits = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", u.token)).body.balances.CREDITS;
  const horseOf = async (u: User) => (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!;
  const reference = async (horseId: string, u: User) => {
    // Ask the API for the allowed band by submitting an absurd price.
    const r = await t.post<{ error: { details: { reference: number } } }>(
      "/market/listings",
      { horseId, type: "FIXED", price: 1 },
      u.token,
    );
    return r.body.error.details.reference;
  };
  const fund = async (u: User, amount: number) =>
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

  beforeAll(async () => {
    t = await createTestApp();
    seller = await t.login(7001, "Seller");
    for (let i = 0; i < 6; i++) {
      const b = await t.login(7100 + i, `Buyer${i}`);
      await fund(b, 200_000);
      buyers.push(b);
    }
  });
  afterAll(() => t.close());

  it("validates listings: ownership, price band, horse availability", async () => {
    const h = await horseOf(seller);
    expect(
      (await t.post("/market/listings", { horseId: h.id, type: "FIXED", price: 5000 }, buyers[0]!.token))
        .status,
    ).toBe(403);
    const low = await t.post<{ error: { code: string } }>(
      "/market/listings",
      { horseId: h.id, type: "FIXED", price: 1 },
      seller.token,
    );
    expect(low.status).toBe(400);
    expect(low.body.error.code).toBe("PRICE_OUT_OF_RANGE");
    const ref = await reference(h.id, seller);
    expect(
      (
        await t.post(
          "/market/listings",
          { horseId: h.id, type: "AUCTION", price: ref, durationHours: 5 },
          seller.token,
        )
      ).status,
    ).toBe(400);
  });

  it("sells at a fixed price exactly once under concurrent buyers, moving money and ownership atomically", async () => {
    const h = await horseOf(seller);
    const ref = await reference(h.id, seller);
    const listing = await t.post<MarketListingDetailDto>(
      "/market/listings",
      { horseId: h.id, type: "FIXED", price: ref },
      seller.token,
    );
    expect(listing.status).toBe(201);
    expect((await horseOf(seller)).status).toBe("LISTED");
    // A listed horse cannot train or race.
    expect(
      (await t.post(`/horses/${h.id}/training`, { type: "SPEED", intensity: "NORMAL" }, seller.token)).status,
    ).toBe(409);
    expect((await t.post(`/market/listings/${listing.body.id}/buy`, {}, seller.token)).status).toBe(409);

    const before = await Promise.all([credits(seller), ...buyers.slice(0, 4).map(credits)]);
    const results = await Promise.all(
      buyers.slice(0, 4).map((b) => t.post(`/market/listings/${listing.body.id}/buy`, {}, b.token)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const winnerIdx = results.findIndex((r) => r.status === 201);
    const winner = buyers[winnerIdx]!;

    const fee = Math.floor(ref * 0.06);
    expect(await credits(seller)).toBe(before[0]! + ref - fee);
    expect(await credits(winner)).toBe(before[winnerIdx + 1]! - ref);
    const owned = await t.get<HorseSummaryDto[]>("/horses", winner.token);
    expect(owned.body.map((x) => x.id)).toContain(h.id);
    expect((await t.get<HorseSummaryDto[]>("/horses", seller.token)).body).toHaveLength(0);
    const history = await t.db.query<{ reason: string; price: number }>(
      "SELECT reason, price FROM horse_ownership_history WHERE horse_id = $1 ORDER BY id",
      [h.id],
    );
    expect(history.map((x) => x.reason)).toEqual(["STARTER", "MARKET_SALE"]);
  });

  it("cancels a fixed listing and frees the horse", async () => {
    const owner = buyers[5]!;
    const h = await horseOf(owner);
    const ref = await reference(h.id, owner);
    const l = await t.post<MarketListingDetailDto>(
      "/market/listings",
      { horseId: h.id, type: "FIXED", price: ref * 2 },
      owner.token,
    );
    expect((await t.post(`/market/listings/${l.body.id}/cancel`, {}, buyers[0]!.token)).status).toBe(403);
    const c = await t.post<MarketListingDetailDto>(`/market/listings/${l.body.id}/cancel`, {}, owner.token);
    expect(c.body.status).toBe("CANCELLED");
    expect((await horseOf(owner)).status).toBe("IDLE");
  });

  describe("auctions", () => {
    let auction: MarketListingDetailDto;
    let owner: User;
    let start: number;

    it("escrows bids, refunds the outbid leader and enforces increments", async () => {
      owner = buyers[4]!;
      const h = await horseOf(owner);
      start = await reference(h.id, owner);
      auction = (
        await t.post<MarketListingDetailDto>(
          "/market/listings",
          { horseId: h.id, type: "AUCTION", price: start, durationHours: 24 },
          owner.token,
        )
      ).body;
      expect(auction.minNextBid).toBe(start);
      expect(
        (await t.post(`/market/listings/${auction.id}/bids`, { amount: start }, owner.token)).status,
      ).toBe(409);
      expect((await t.post(`/market/listings/${auction.id}/buy`, {}, buyers[1]!.token)).status).toBe(409);
      expect(
        (await t.post(`/market/listings/${auction.id}/bids`, { amount: start - 1 }, buyers[1]!.token)).status,
      ).toBe(409);

      const b1Before = await credits(buyers[1]!);
      const first = await t.post<MarketListingDetailDto>(
        `/market/listings/${auction.id}/bids`,
        { amount: start },
        buyers[1]!.token,
      );
      expect(first.status).toBe(201);
      expect(first.body.iAmLeading).toBe(true);
      expect(await credits(buyers[1]!)).toBe(b1Before - start);

      const next = first.body.minNextBid;
      expect(next).toBeGreaterThan(start);
      expect(
        (await t.post(`/market/listings/${auction.id}/bids`, { amount: next - 1 }, buyers[2]!.token)).status,
      ).toBe(409);
      expect(
        (await t.post(`/market/listings/${auction.id}/bids`, { amount: next }, buyers[2]!.token)).status,
      ).toBe(201);
      expect(await credits(buyers[1]!)).toBe(b1Before); // refunded in full
      const mine = await t.get<MarketMineDto>("/market/mine", buyers[1]!.token);
      expect(mine.body.bids[0]).toMatchObject({ id: auction.id, iAmLeading: false });
    });

    it("accepts exactly one of several simultaneous bids at the same minimum", async () => {
      const d = (await t.get<MarketListingDetailDto>(`/market/listings/${auction.id}`, buyers[0]!.token))
        .body;
      const racers = [buyers[0]!, buyers[1]!, buyers[3]!];
      const res = await Promise.all(
        racers.map((b) => t.post(`/market/listings/${auction.id}/bids`, { amount: d.minNextBid }, b.token)),
      );
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      const leading = await t.db.query(
        "SELECT * FROM market_bids WHERE listing_id = $1 AND status = 'LEADING'",
        [auction.id],
      );
      expect(leading).toHaveLength(1);
      const escrow = await t.db.one<{ balance: number }>(
        "SELECT balance FROM accounts WHERE owner_type = 'ESCROW' AND code = 'MARKET'",
      );
      expect(escrow!.balance).toBe(d.minNextBid);
    });

    it("extends the auction when a bid lands in the final minutes", async () => {
      const d = (await t.get<MarketListingDetailDto>(`/market/listings/${auction.id}`, buyers[0]!.token))
        .body;
      t.clock.advance(new Date(d.endsAt).getTime() - t.clock.now().getTime() - 60_000); // 1 minute left
      const leader = d.bids[0]!;
      const bidder = buyers.find((b) => !(leader.mine && b.token === buyers[0]!.token))!;
      const next = await t.post<MarketListingDetailDto>(
        `/market/listings/${auction.id}/bids`,
        { amount: d.minNextBid },
        bidder.token,
      );
      expect(next.status).toBe(201);
      const remaining = new Date(next.body.endsAt).getTime() - t.clock.now().getTime();
      expect(remaining).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    });

    it("settles once: winner gets the horse, seller the proceeds, losers keep their money, escrow empties", async () => {
      const d = (await t.get<MarketListingDetailDto>(`/market/listings/${auction.id}`, owner.token)).body;
      const winnerBid = d.highestBid!;
      const sellerBefore = await credits(owner);
      const market = t.service(MarketService);
      expect(await market.settleDue()).toBe(0);
      t.clock.advance(10 * 60_000);
      expect(await market.settleDue()).toBe(1);
      expect(await market.settle(auction.id)).toBe(false);

      const done = (await t.get<MarketListingDetailDto>(`/market/listings/${auction.id}`, owner.token)).body;
      expect(done.status).toBe("SOLD");
      expect(await credits(owner)).toBe(sellerBefore + winnerBid - Math.floor(winnerBid * 0.06));
      const escrow = await t.db.one<{ balance: number }>(
        "SELECT balance FROM accounts WHERE owner_type = 'ESCROW' AND code = 'MARKET'",
      );
      expect(escrow!.balance).toBe(0);
      const winnerRow = await t.db.one<{ bidder_id: string }>(
        "SELECT bidder_id FROM market_bids WHERE listing_id = $1 AND status = 'WON'",
        [auction.id],
      );
      const horse = await t.db.one<{ owner_id: string; status: string }>(
        "SELECT owner_id, status FROM horses WHERE id = $1",
        [done.horse.id],
      );
      expect(horse).toMatchObject({ owner_id: winnerRow!.bidder_id, status: "IDLE" });
    });

    it("expires an auction without bids and returns the horse", async () => {
      const o = buyers[3]!;
      const h = await horseOf(o);
      const ref = await reference(h.id, o);
      const l = (
        await t.post<MarketListingDetailDto>(
          "/market/listings",
          { horseId: h.id, type: "AUCTION", price: ref, durationHours: 24 },
          o.token,
        )
      ).body;
      t.clock.advance(25 * 3_600_000);
      await t.service(MarketService).settleDue();
      expect((await t.get<MarketListingDetailDto>(`/market/listings/${l.id}`, o.token)).body.status).toBe(
        "EXPIRED",
      );
      expect(
        (await t.get<HorseSummaryDto[]>("/horses", o.token)).body.find((x) => x.id === h.id)!.status,
      ).toBe("IDLE");
    });
  });

  it("does not let bids exceed stable capacity", async () => {
    // Seller now has 0 horses and a 3-box stable: may lead at most 3 auctions.
    const sellers = buyers.slice(0, 3);
    const ids: string[] = [];
    for (const s of sellers) {
      const h = (await t.get<HorseSummaryDto[]>("/horses", s.token)).body.find((x) => x.status === "IDLE")!;
      const ref = await reference(h.id, s);
      ids.push(
        (
          await t.post<MarketListingDetailDto>(
            "/market/listings",
            { horseId: h.id, type: "AUCTION", price: ref, durationHours: 24 },
            s.token,
          )
        ).body.id,
      );
    }
    await fund(seller, 500_000);
    const four = await t.login(7200, "Extra");
    await fund(four, 200_000);
    const h4 = await horseOf(four);
    ids.push(
      (
        await t.post<MarketListingDetailDto>(
          "/market/listings",
          { horseId: h4.id, type: "AUCTION", price: await reference(h4.id, four), durationHours: 24 },
          four.token,
        )
      ).body.id,
    );
    const statuses: number[] = [];
    for (const id of ids) {
      const d = (await t.get<MarketListingDto>(`/market/listings/${id}`, seller.token)).body;
      statuses.push(
        (await t.post(`/market/listings/${id}/bids`, { amount: d.minNextBid }, seller.token)).status,
      );
    }
    expect(statuses).toEqual([201, 201, 201, 409]);
  });

  it("lists active listings with sorting and keeps the ledger balanced", async () => {
    const list = await t.get<MarketListingDto[]>("/market/listings?sort=price_asc", seller.token);
    expect(list.status).toBe(200);
    const prices = list.body.map((l) => l.highestBid ?? l.price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    await assertLedgerIntegrity(t.db);
  });
});
