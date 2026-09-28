import { Injectable } from "@nestjs/common";
import type { HorseOfferDto, OffersDto } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { conflict, forbidden, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { getHorse, type HorseRow, transferHorse } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { StableService } from "../stable/stable.service.js";

interface OfferRow {
  id: string;
  horse_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  status: HorseOfferDto["status"];
  created_at: Date;
  expires_at: Date;
  closed_at: Date | null;
}

/**
 * Offers on horses that are not for sale. The amount moves to the market escrow when the offer is
 * made and comes back on decline, withdrawal or expiry. Accepting sells the horse like a market
 * sale (same price band, fee and ownership transfer); every other open offer on it is refunded.
 */
@Injectable()
export class OffersService {
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

  /** Allowed offer range for a horse: the market's sanity band around its valuation. */
  band(h: HorseRow, now: Date): { min: number; max: number } {
    const v = this.horses.valuation(h, now);
    return { min: Math.floor(v * this.cfg.minPriceFactor), max: Math.ceil(v * this.cfg.maxPriceFactor) };
  }

  /** Whether `viewerId` may make an offer on this horse at all. */
  canOffer(h: HorseRow, viewerId: string): boolean {
    // A horse already on the market is bought or bid on there.
    return (
      !h.is_house && !h.retired_at && h.owner_id !== null && h.owner_id !== viewerId && h.status !== "LISTED"
    );
  }

  private async refund(c: Queryable, o: OfferRow, status: "DECLINED" | "WITHDRAWN" | "EXPIRED", now: Date) {
    await c.query("UPDATE horse_offers SET status = $2, closed_at = $3 WHERE id = $1", [o.id, status, now]);
    await this.ledger.post(c, {
      idempotencyKey: `offer:${o.id}:refund`,
      type: "OFFER_REFUND",
      reason: `Offer ${status.toLowerCase()} — escrow returned`,
      metadata: { offerId: o.id, horseId: o.horse_id },
      entries: [
        { account: { escrow: "MARKET", currency: "CREDITS" }, amount: -o.amount },
        { account: { user: o.buyer_id, currency: "CREDITS" }, amount: o.amount },
      ],
    });
  }

  async make(buyerId: string, horseId: string, amount: number): Promise<HorseOfferDto> {
    const now = this.clock.now();
    const id = await this.db.tx(async (c) => {
      const h = await getHorse(c, horseId, true);
      if (!this.canOffer(h, buyerId))
        throw h.owner_id === buyerId
          ? conflict("SELF_TRADE", "This is your own horse")
          : conflict("NOT_FOR_OFFERS", "This horse cannot receive offers");
      const band = this.band(h, now);
      if (amount < band.min || amount > band.max)
        throw conflict("PRICE_OUT_OF_BAND", `Offer between ${band.min} and ${band.max} credits`, band);
      const open = await row<{ n: number; here: number }>(
        c,
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE horse_id = $2)::int AS here
           FROM horse_offers WHERE buyer_id = $1 AND status = 'OPEN'`,
        [buyerId, horseId],
      );
      if (open!.here > 0) throw conflict("OFFER_EXISTS", "You already have an open offer on this horse");
      if (open!.n >= this.cfg.maxOpenOffers)
        throw conflict("OFFER_LIMIT", `You can hold up to ${this.cfg.maxOpenOffers} open offers`);
      const stable = await this.stables.byOwner(c, buyerId);
      const owned = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM horses WHERE owner_id = $1 AND retired_at IS NULL",
        [buyerId],
      );
      if (owned!.n + 1 > this.stables.capacity(stable.level))
        throw conflict("STABLE_FULL", "No free box for another horse");
      const o = await row<{ id: string }>(
        c,
        `INSERT INTO horse_offers (horse_id, buyer_id, seller_id, amount, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          horseId,
          buyerId,
          h.owner_id,
          amount,
          now,
          new Date(now.getTime() + this.cfg.offerHours * 3_600_000),
        ],
      );
      await this.ledger.post(c, {
        idempotencyKey: `offer:${o!.id}`,
        type: "OFFER_ESCROW",
        reason: `Offer for ${h.name} held in escrow`,
        actorId: buyerId,
        metadata: { offerId: o!.id, horseId },
        entries: [
          { account: { user: buyerId, currency: "CREDITS" }, amount: -amount },
          { account: { escrow: "MARKET", currency: "CREDITS" }, amount },
        ],
      });
      await this.events.emit(c, {
        type: "offer_received",
        aggregateType: "horse",
        aggregateId: horseId,
        actorId: buyerId,
        payload: { userId: h.owner_id, horseName: h.name, amount },
      });
      return o!.id;
    });
    return this.one(id);
  }

  private async lockOffer(c: Queryable, id: string): Promise<OfferRow> {
    const o = await row<OfferRow>(c, "SELECT * FROM horse_offers WHERE id = $1 FOR UPDATE", [id]);
    if (!o) throw notFound("Offer");
    return o;
  }

  async accept(sellerId: string, offerId: string): Promise<HorseOfferDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const o = await this.lockOffer(c, offerId);
      if (o.seller_id !== sellerId) throw forbidden("Not your offer");
      if (o.status !== "OPEN" || o.expires_at <= now) throw conflict("OFFER_CLOSED", "This offer is closed");
      let h = await this.horses.lockOwned(c, o.horse_id, sellerId);
      h = await this.horses.normalize(c, h, now);
      if (h.status !== "IDLE") throw conflict("HORSE_BUSY", `Horse is ${h.status.toLowerCase()}`);
      const partners = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM horse_shares WHERE horse_id = $1",
        [h.id],
      );
      if (partners!.n > 0) throw conflict("SYNDICATED", "Buy back the syndicate shares before selling");
      await this.horses.assertKeepsAHorse(c, sellerId, h.id);
      const stable = await this.stables.byOwner(c, o.buyer_id, true);
      const owned = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM horses WHERE owner_id = $1 AND retired_at IS NULL",
        [o.buyer_id],
      );
      if (owned!.n + 1 > this.stables.capacity(stable.level))
        throw conflict("BUYER_STABLE_FULL", "The buyer has no free box any more");
      const fee = Math.round(o.amount * this.cfg.saleFeeRate);
      await c.query("UPDATE horse_offers SET status = 'ACCEPTED', closed_at = $2 WHERE id = $1", [o.id, now]);
      await this.ledger.post(c, {
        idempotencyKey: `offer:${o.id}:settle`,
        type: "OFFER_SALE",
        reason: `Sold ${h.name} (offer)`,
        metadata: { offerId: o.id, horseId: h.id, fee },
        entries: [
          { account: { escrow: "MARKET", currency: "CREDITS" }, amount: -o.amount },
          { account: { user: sellerId, currency: "CREDITS" }, amount: o.amount - fee },
          ...(fee > 0
            ? [{ account: { system: "MARKET_FEES" as const, currency: "CREDITS" as const }, amount: fee }]
            : []),
        ],
      });
      await transferHorse(c, h, { userId: o.buyer_id, stableId: stable.id }, "OFFER", o.amount, now);
      // Everyone else's open offers on this horse go back to them.
      const others = await rows<OfferRow>(
        c,
        "SELECT * FROM horse_offers WHERE horse_id = $1 AND status = 'OPEN' AND id <> $2 FOR UPDATE",
        [h.id, o.id],
      );
      for (const x of others) await this.refund(c, x, "EXPIRED", now);
      await this.events.emit(c, {
        type: "offer_accepted",
        aggregateType: "horse",
        aggregateId: h.id,
        actorId: sellerId,
        payload: { userId: o.buyer_id, horseName: h.name, amount: o.amount },
      });
    });
    return this.one(offerId);
  }

  async decline(sellerId: string, offerId: string): Promise<HorseOfferDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const o = await this.lockOffer(c, offerId);
      if (o.seller_id !== sellerId) throw forbidden("Not your offer");
      if (o.status !== "OPEN") throw conflict("OFFER_CLOSED", "This offer is closed");
      await this.refund(c, o, "DECLINED", now);
      const h = await getHorse(c, o.horse_id);
      await this.events.emit(c, {
        type: "offer_declined",
        aggregateType: "horse",
        aggregateId: o.horse_id,
        actorId: sellerId,
        payload: { userId: o.buyer_id, horseName: h.name, amount: o.amount },
      });
    });
    return this.one(offerId);
  }

  async withdraw(buyerId: string, offerId: string): Promise<HorseOfferDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const o = await this.lockOffer(c, offerId);
      if (o.buyer_id !== buyerId) throw forbidden("Not your offer");
      if (o.status !== "OPEN") throw conflict("OFFER_CLOSED", "This offer is closed");
      await this.refund(c, o, "WITHDRAWN", now);
    });
    return this.one(offerId);
  }

  /** Refund offers past their time, or whose horse changed hands or retired. */
  async expireDue(limit = 200): Promise<number> {
    const now = this.clock.now();
    const due = await this.db.query<{ id: string }>(
      `SELECT o.id FROM horse_offers o JOIN horses h ON h.id = o.horse_id
        WHERE o.status = 'OPEN'
          AND (o.expires_at <= $1 OR h.owner_id IS DISTINCT FROM o.seller_id OR h.retired_at IS NOT NULL)
        ORDER BY o.expires_at LIMIT $2`,
      [now, limit],
    );
    let n = 0;
    for (const d of due)
      await this.db.tx(async (c) => {
        const o = await row<OfferRow>(c, "SELECT * FROM horse_offers WHERE id = $1 FOR UPDATE SKIP LOCKED", [
          d.id,
        ]);
        if (!o || o.status !== "OPEN") return;
        await this.refund(c, o, "EXPIRED", now);
        n++;
      });
    return n;
  }

  private async dtos(list: (OfferRow & { buyer_name: string | null; seller_name: string | null })[]) {
    if (!list.length) return [];
    const now = this.clock.now();
    const horses = new Map(
      (
        await rows<HorseRow>(this.db.pool, "SELECT * FROM horses WHERE id = ANY($1::uuid[])", [
          list.map((o) => o.horse_id),
        ])
      ).map((h) => [h.id, h] as const),
    );
    const fee = this.cfg.saleFeeRate;
    return list.map((o): HorseOfferDto => ({
      id: o.id,
      horse: this.horses.summary(horses.get(o.horse_id)!, now),
      amount: Number(o.amount),
      status: o.status === "OPEN" && o.expires_at <= now ? "EXPIRED" : o.status,
      expiresAt: o.expires_at.toISOString(),
      createdAt: o.created_at.toISOString(),
      buyerName: o.buyer_name,
      sellerName: o.seller_name,
      net: Number(o.amount) - Math.round(Number(o.amount) * fee),
    }));
  }

  private readonly select = `SELECT o.*, COALESCE(b.username, b.first_name) AS buyer_name,
                                    COALESCE(s.username, s.first_name) AS seller_name
                               FROM horse_offers o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id`;

  async one(id: string): Promise<HorseOfferDto> {
    const [o] = await this.dtos(await this.db.query(`${this.select} WHERE o.id = $1`, [id]));
    if (!o) throw notFound("Offer");
    return o;
  }

  /** The player's offers: received on their horses and made on others' (open first, then recent). */
  async mine(userId: string): Promise<OffersDto> {
    const order = "ORDER BY (o.status = 'OPEN') DESC, o.created_at DESC LIMIT 30";
    return {
      received: await this.dtos(
        await this.db.query(`${this.select} WHERE o.seller_id = $1 ${order}`, [userId]),
      ),
      made: await this.dtos(await this.db.query(`${this.select} WHERE o.buyer_id = $1 ${order}`, [userId])),
    };
  }
}
