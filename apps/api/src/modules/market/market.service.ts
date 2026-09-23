import { Injectable } from "@nestjs/common";
import type {
  CreateListingRequest,
  MarketListingDetailDto,
  MarketListingDto,
  MarketMineDto,
  MarketQuery,
} from "@thoroughline/contracts";
import { assertTransition } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { getHorse, type HorseRow, transferHorse } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { StableService } from "../stable/stable.service.js";

interface ListingRow {
  id: string;
  horse_id: string;
  seller_id: string;
  type: "FIXED" | "AUCTION";
  status: "ACTIVE" | "SOLD" | "CANCELLED" | "EXPIRED";
  price: number;
  reference_value: number;
  ends_at: Date;
  highest_bid: number | null;
  highest_bidder: string | null;
  bid_count: number;
  buyer_id: string | null;
  sale_price: number | null;
  fee: number | null;
  created_at: Date;
  closed_at: Date | null;
}

interface BidRow {
  id: string;
  listing_id: string;
  bidder_id: string;
  amount: number;
  status: "LEADING" | "OUTBID" | "WON" | "REFUNDED";
  created_at: Date;
}

type ListingView = ListingRow & { seller_name: string | null };

/**
 * Player-to-player market. Server-authoritative throughout:
 *  - lock order is always listing → stable → horse (no deadlocks);
 *  - money moves only through balanced ledger postings with per-action idempotency keys;
 *  - auction bids are escrowed immediately, the previous leader is refunded in the same
 *    transaction, and settlement runs exactly once (status guard + row lock).
 */
@Injectable()
export class MarketService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly stables: StableService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  private get cfg() {
    return this.config.get().market;
  }

  fee(amount: number): number {
    return Math.floor(amount * this.cfg.saleFeeRate);
  }

  minNextBid(l: Pick<ListingRow, "type" | "price" | "highest_bid">): number {
    if (l.type === "FIXED" || l.highest_bid === null) return l.price;
    return (
      l.highest_bid + Math.max(this.cfg.minIncrement, Math.ceil(l.highest_bid * this.cfg.minIncrementRate))
    );
  }

  /* ───────────────────────────── commands ───────────────────────────── */

  async create(sellerId: string, req: CreateListingRequest): Promise<MarketListingDetailDto> {
    const now = this.clock.now();
    const cfg = this.cfg;
    let hours: number;
    if (req.type === "AUCTION") {
      hours = req.durationHours ?? cfg.auctionHours[0]!;
      if (!cfg.auctionHours.includes(hours)) {
        throw badRequest("INVALID_DURATION", `Auctions last ${cfg.auctionHours.join(", ")} hours`);
      }
    } else hours = cfg.fixedListingDays * 24;

    const id = await this.db.tx(async (c) => {
      let h = await this.horses.lockOwned(c, req.horseId, sellerId);
      h = await this.horses.normalize(c, h, now);
      if (h.status !== "IDLE") throw conflict("HORSE_BUSY", `Horse is ${h.status.toLowerCase()}`);
      assertTransition(h.status, "LISTED");
      const reference = this.horses.valuation(h, now);
      const [lo, hi] = [
        Math.floor(reference * cfg.minPriceFactor),
        Math.ceil(reference * cfg.maxPriceFactor),
      ];
      if (req.price < lo || req.price > hi) {
        throw badRequest(
          "PRICE_OUT_OF_RANGE",
          `Price must be between ${lo} and ${hi} credits for this horse`,
          {
            min: lo,
            max: hi,
            reference,
          },
        );
      }
      const l = await row<{ id: string }>(
        c,
        `INSERT INTO market_listings (horse_id, seller_id, type, price, reference_value, ends_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [h.id, sellerId, req.type, req.price, reference, new Date(now.getTime() + hours * 3_600_000), now],
      );
      await c.query("UPDATE horses SET status = 'LISTED', updated_at = $2 WHERE id = $1", [h.id, now]);
      await this.events.emit(c, {
        type: "market_listing_created",
        aggregateType: "listing",
        aggregateId: l!.id,
        actorId: sellerId,
        payload: { horseId: h.id, type: req.type, price: req.price, reference },
      });
      return l!.id;
    });
    return this.detail(id, sellerId);
  }

  async cancel(sellerId: string, listingId: string): Promise<MarketListingDetailDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const l = await this.lockListing(c, listingId);
      if (l.seller_id !== sellerId) throw forbidden("Not your listing");
      if (l.status !== "ACTIVE") throw conflict("LISTING_CLOSED", `Listing is ${l.status.toLowerCase()}`);
      if (l.bid_count > 0) throw conflict("HAS_BIDS", "An auction with bids cannot be cancelled");
      await c.query("UPDATE market_listings SET status = 'CANCELLED', closed_at = $2 WHERE id = $1", [
        l.id,
        now,
      ]);
      await c.query(
        "UPDATE horses SET status = 'IDLE', updated_at = $2 WHERE id = $1 AND status = 'LISTED'",
        [l.horse_id, now],
      );
      await this.events.emit(c, {
        type: "market_listing_cancelled",
        aggregateType: "listing",
        aggregateId: l.id,
        actorId: sellerId,
      });
    });
    return this.detail(listingId, sellerId);
  }

  /** Buy a fixed-price listing: buyer pays the price, seller receives price − fee, fee is burned. */
  async buy(buyerId: string, listingId: string): Promise<MarketListingDetailDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const l = await this.lockListing(c, listingId);
      if (l.type !== "FIXED") throw conflict("NOT_FIXED_PRICE", "This is an auction — place a bid instead");
      this.assertOpen(l, now);
      if (l.seller_id === buyerId) throw conflict("SELF_TRADE", "You cannot buy your own horse");
      const stable = await this.stables.byOwner(c, buyerId, true);
      await this.stables.assertHasRoom(c, stable);
      const h = await getHorse(c, l.horse_id, true);
      const fee = this.fee(l.price);
      await this.ledger.post(c, {
        idempotencyKey: `market:${l.id}:sale`,
        type: "MARKET_SALE",
        reason: `Sale of ${h.name}`,
        actorId: buyerId,
        metadata: { listingId: l.id, horseId: h.id, seller: l.seller_id, buyer: buyerId },
        entries: [
          { account: { user: buyerId, currency: "CREDITS" }, amount: -l.price },
          { account: { user: l.seller_id, currency: "CREDITS" }, amount: l.price - fee },
          ...(fee > 0
            ? [{ account: { system: "MARKET_FEES" as const, currency: "CREDITS" as const }, amount: fee }]
            : []),
        ],
      });
      await this.complete(c, l, h, buyerId, stable.id, l.price, fee, now);
    });
    return this.detail(listingId, buyerId);
  }

  async bid(bidderId: string, listingId: string, amount: number): Promise<MarketListingDetailDto> {
    const now = this.clock.now();
    const cfg = this.cfg;
    await this.db.tx(async (c) => {
      const l = await this.lockListing(c, listingId);
      if (l.type !== "AUCTION") throw conflict("NOT_AUCTION", "This listing is fixed price — buy it instead");
      this.assertOpen(l, now);
      if (l.seller_id === bidderId) throw conflict("SELF_TRADE", "You cannot bid on your own horse");
      const min = this.minNextBid(l);
      if (amount < min) throw conflict("BID_TOO_LOW", `Minimum bid is ${min} credits`, { min });

      // A box must be free for every auction the bidder is currently winning, plus this one.
      const stable = await this.stables.byOwner(c, bidderId, true);
      const owned = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM horses WHERE owner_id = $1 AND retired_at IS NULL",
        [bidderId],
      );
      const leading = await row<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM market_listings WHERE status = 'ACTIVE' AND highest_bidder = $1 AND id <> $2`,
        [bidderId, l.id],
      );
      if (owned!.n + leading!.n + 1 > this.stables.capacity(stable.level)) {
        throw conflict("STABLE_FULL", "No free box for this horse (count includes auctions you are winning)");
      }

      const previous = await row<BidRow>(
        c,
        "SELECT * FROM market_bids WHERE listing_id = $1 AND status = 'LEADING' FOR UPDATE",
        [l.id],
      );
      if (previous) {
        await c.query("UPDATE market_bids SET status = 'OUTBID' WHERE id = $1", [previous.id]);
        await this.ledger.post(c, {
          idempotencyKey: `bid:${previous.id}:refund`,
          type: "BID_REFUND",
          reason: "Outbid — escrow returned",
          metadata: { listingId: l.id, bidId: previous.id },
          entries: [
            { account: { escrow: "MARKET", currency: "CREDITS" }, amount: -previous.amount },
            { account: { user: previous.bidder_id, currency: "CREDITS" }, amount: previous.amount },
          ],
        });
      }
      const bid = await row<{ id: string }>(
        c,
        "INSERT INTO market_bids (listing_id, bidder_id, amount, created_at) VALUES ($1,$2,$3,$4) RETURNING id",
        [l.id, bidderId, amount, now],
      );
      await this.ledger.post(c, {
        idempotencyKey: `bid:${bid!.id}`,
        type: "BID_ESCROW",
        reason: "Bid held in escrow",
        actorId: bidderId,
        metadata: { listingId: l.id, bidId: bid!.id },
        entries: [
          { account: { user: bidderId, currency: "CREDITS" }, amount: -amount },
          { account: { escrow: "MARKET", currency: "CREDITS" }, amount },
        ],
      });
      const snipeFloor = new Date(now.getTime() + cfg.antiSnipeMinutes * 60_000);
      await c.query(
        `UPDATE market_listings SET highest_bid = $2, highest_bidder = $3, bid_count = bid_count + 1,
                ends_at = GREATEST(ends_at, $4) WHERE id = $1`,
        [l.id, amount, bidderId, snipeFloor],
      );
      await this.events.emit(c, {
        type: "market_bid_placed",
        aggregateType: "listing",
        aggregateId: l.id,
        actorId: bidderId,
        payload: { amount, outbid: previous && previous.bidder_id !== bidderId ? previous.bidder_id : null },
      });
      if (previous && previous.bidder_id !== bidderId) {
        const h = await getHorse(c, l.horse_id);
        await this.events.emit(c, {
          type: "market_outbid",
          aggregateType: "listing",
          aggregateId: l.id,
          payload: { userId: previous.bidder_id, horseName: h.name, amount },
        });
      }
    });
    return this.detail(listingId, bidderId);
  }

  /** Close every listing whose time is up. Idempotent and safe across workers. */
  async settleDue(limit = 100): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM market_listings WHERE status = 'ACTIVE' AND ends_at <= $1 ORDER BY ends_at LIMIT $2",
      [this.clock.now(), limit],
    );
    let n = 0;
    for (const d of due) if (await this.settle(d.id)) n++;
    return n;
  }

  async settle(listingId: string): Promise<boolean> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const l = await row<ListingRow>(
        c,
        "SELECT * FROM market_listings WHERE id = $1 FOR UPDATE SKIP LOCKED",
        [listingId],
      );
      if (!l || l.status !== "ACTIVE" || l.ends_at > now) return false;
      const winning =
        l.type === "AUCTION"
          ? await row<BidRow>(
              c,
              "SELECT * FROM market_bids WHERE listing_id = $1 AND status = 'LEADING' FOR UPDATE",
              [l.id],
            )
          : null;
      if (!winning) {
        await c.query("UPDATE market_listings SET status = 'EXPIRED', closed_at = $2 WHERE id = $1", [
          l.id,
          now,
        ]);
        await c.query(
          "UPDATE horses SET status = 'IDLE', updated_at = $2 WHERE id = $1 AND status = 'LISTED'",
          [l.horse_id, now],
        );
        await this.events.emit(c, {
          type: "market_listing_expired",
          aggregateType: "listing",
          aggregateId: l.id,
        });
        return true;
      }
      const stable = await this.stables.byOwner(c, winning.bidder_id, true);
      const h = await getHorse(c, l.horse_id, true);
      const fee = this.fee(winning.amount);
      await this.ledger.post(c, {
        idempotencyKey: `market:${l.id}:sale`,
        type: "MARKET_SALE",
        reason: `Auction of ${h.name}`,
        metadata: { listingId: l.id, horseId: h.id, seller: l.seller_id, buyer: winning.bidder_id },
        entries: [
          { account: { escrow: "MARKET", currency: "CREDITS" }, amount: -winning.amount },
          { account: { user: l.seller_id, currency: "CREDITS" }, amount: winning.amount - fee },
          ...(fee > 0
            ? [{ account: { system: "MARKET_FEES" as const, currency: "CREDITS" as const }, amount: fee }]
            : []),
        ],
      });
      await c.query("UPDATE market_bids SET status = 'WON' WHERE id = $1", [winning.id]);
      await this.complete(c, l, h, winning.bidder_id, stable.id, winning.amount, fee, now);
      return true;
    });
  }

  private async complete(
    c: Queryable,
    l: ListingRow,
    h: HorseRow,
    buyerId: string,
    buyerStableId: string,
    price: number,
    fee: number,
    now: Date,
  ): Promise<void> {
    await transferHorse(
      c,
      h,
      { userId: buyerId, stableId: buyerStableId },
      l.type === "AUCTION" ? "AUCTION" : "MARKET_SALE",
      price,
      now,
    );
    await c.query(
      `UPDATE market_listings SET status = 'SOLD', buyer_id = $2, sale_price = $3, fee = $4, closed_at = $5 WHERE id = $1`,
      [l.id, buyerId, price, fee, now],
    );
    await this.events.emit(c, {
      type: "market_sale_completed",
      aggregateType: "listing",
      aggregateId: l.id,
      actorId: buyerId,
      payload: { userId: l.seller_id, buyerId, horseId: h.id, horseName: h.name, price, fee },
    });
  }

  private async lockListing(c: Queryable, id: string): Promise<ListingRow> {
    const l = await row<ListingRow>(c, "SELECT * FROM market_listings WHERE id = $1 FOR UPDATE", [id]);
    if (!l) throw notFound("Listing");
    return l;
  }

  private assertOpen(l: ListingRow, now: Date): void {
    if (l.status !== "ACTIVE" || l.ends_at <= now)
      throw conflict("LISTING_CLOSED", "This listing has closed");
  }

  /* ───────────────────────────── queries ───────────────────────────── */

  private async views(
    c: Queryable,
    where: string,
    params: unknown[],
    order = "l.created_at DESC",
    limit = 50,
  ) {
    return rows<ListingView>(
      c,
      `SELECT l.*, COALESCE(u.username, u.first_name) AS seller_name
         FROM market_listings l JOIN users u ON u.id = l.seller_id JOIN horses h ON h.id = l.horse_id
        WHERE ${where} ORDER BY ${order} LIMIT ${Number(limit)}`,
      params,
    );
  }

  private async toDtos(list: ListingView[], viewerId: string | null): Promise<MarketListingDto[]> {
    if (list.length === 0) return [];
    const now = this.clock.now();
    const horses = new Map(
      (
        await rows<HorseRow>(this.db.pool, "SELECT * FROM horses WHERE id = ANY($1::uuid[])", [
          list.map((l) => l.horse_id),
        ])
      ).map((h) => [h.id, h] as const),
    );
    return list.map((l) => ({
      id: l.id,
      type: l.type,
      status: l.status === "ACTIVE" && l.ends_at <= now ? "EXPIRED" : l.status,
      price: l.price,
      referenceValue: l.reference_value,
      endsAt: l.ends_at.toISOString(),
      highestBid: l.highest_bid,
      bidCount: l.bid_count,
      minNextBid: this.minNextBid(l),
      salePrice: l.sale_price,
      sellerName: l.seller_name,
      mine: viewerId === l.seller_id,
      iAmLeading: viewerId !== null && l.highest_bidder === viewerId,
      horse: this.horses.marketCard(horses.get(l.horse_id)!, now, l.highest_bid ?? l.price, l.seller_name),
    }));
  }

  async list(q: MarketQuery, viewerId: string): Promise<MarketListingDto[]> {
    const order = {
      ending: "l.ends_at ASC",
      price_asc: "COALESCE(l.highest_bid, l.price) ASC",
      price_desc: "COALESCE(l.highest_bid, l.price) DESC",
      newest: "l.created_at DESC",
      rating: "h.ability_rating DESC",
    }[q.sort];
    const list = await this.views(
      this.db.pool,
      "l.status = 'ACTIVE' AND l.ends_at > $1 AND ($2::text IS NULL OR l.type = $2)",
      [this.clock.now(), q.type ?? null],
      order,
      q.limit,
    );
    return this.toDtos(list, viewerId);
  }

  async detail(id: string, viewerId: string | null): Promise<MarketListingDetailDto> {
    const [l] = await this.views(this.db.pool, "l.id = $1", [id]);
    if (!l) throw notFound("Listing");
    const [dto] = await this.toDtos([l], viewerId);
    const bids = await this.db.query<BidRow & { bidder_name: string | null }>(
      `SELECT b.*, COALESCE(u.username, u.first_name) AS bidder_name FROM market_bids b JOIN users u ON u.id = b.bidder_id
        WHERE b.listing_id = $1 ORDER BY b.amount DESC LIMIT 20`,
      [id],
    );
    return {
      ...dto!,
      feeRate: this.cfg.saleFeeRate,
      bids: bids.map((b) => ({
        amount: b.amount,
        bidderName: b.bidder_name,
        createdAt: b.created_at.toISOString(),
        mine: b.bidder_id === viewerId,
      })),
    };
  }

  async mine(userId: string): Promise<MarketMineDto> {
    const listings = await this.views(this.db.pool, "l.seller_id = $1", [userId], "l.created_at DESC", 30);
    const bids = await this.views(
      this.db.pool,
      "l.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM market_bids b WHERE b.listing_id = l.id AND b.bidder_id = $1)",
      [userId],
      "l.ends_at ASC",
      30,
    );
    return { listings: await this.toDtos(listings, userId), bids: await this.toDtos(bids, userId) };
  }

  /** Recent completed sales for price discovery. */
  async recentSales(limit = 20) {
    return this.db.query<{
      id: string;
      horse_name: string;
      sale_price: number;
      type: string;
      closed_at: Date;
    }>(
      `SELECT l.id, h.name AS horse_name, l.sale_price, l.type, l.closed_at
         FROM market_listings l JOIN horses h ON h.id = l.horse_id
        WHERE l.status = 'SOLD' ORDER BY l.closed_at DESC LIMIT $1`,
      [limit],
    );
  }
}
