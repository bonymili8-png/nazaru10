import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  MyShareDto,
  ShareOfferDto,
  ShareOfferRequest,
  SyndicateDto,
  SyndicatePartnerDto,
} from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService, type SystemAccount } from "../economy/ledger.service.js";
import { getHorse, type HorseRow } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";

interface ShareRow {
  holder_id: string;
  name: string;
  shares: number;
  cost_paid: number;
}

interface OfferRow {
  horse_id: string;
  manager_id: string;
  price_per_share: number;
  available: number;
}

/**
 * Syndicates: a horse's owner (the manager) sells up to `maxPartnerShares` of `totalShares` equal
 * shares to other players. The manager keeps full control (training, entries, breeding) and the
 * stud fees; race and tournament prize money is split pro rata. While partners hold shares the
 * horse cannot change hands; the manager can dissolve the syndicate by buying every share back
 * at the price its holder paid.
 */
@Injectable()
export class SyndicatesService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  private get cfg() {
    return this.config.get().syndicates;
  }

  private partners(c: Queryable, horseId: string): Promise<ShareRow[]> {
    return rows<ShareRow>(
      c,
      `SELECT s.holder_id, COALESCE(u.first_name, u.username, 'Owner') AS name, s.shares, s.cost_paid
         FROM horse_shares s JOIN users u ON u.id = s.holder_id WHERE s.horse_id = $1
        ORDER BY s.shares DESC, s.acquired_at`,
      [horseId],
    );
  }

  private async partnerShares(c: Queryable, horseId: string): Promise<number> {
    const r = await row<{ n: number }>(
      c,
      "SELECT COALESCE(sum(shares), 0)::int AS n FROM horse_shares WHERE horse_id = $1",
      [horseId],
    );
    return r!.n;
  }

  /** Blocks anything that would move a syndicated horse to a new owner. */
  async assertNoPartners(c: Queryable, horseId: string): Promise<void> {
    if ((await this.partnerShares(c, horseId)) > 0)
      throw conflict("SYNDICATED", "This horse has co-owners — dissolve the syndicate first");
  }

  private band(h: HorseRow): { min: number; max: number } {
    const perShare = this.horses.valuation(h, this.clock.now()) / this.cfg.totalShares;
    return {
      min: Math.max(1, Math.floor(perShare * this.cfg.minPriceFactor)),
      max: Math.max(1, Math.ceil(perShare * this.cfg.maxPriceFactor)),
    };
  }

  async view(horseId: string, viewerId: string): Promise<SyndicateDto> {
    const h = await getHorse(this.db.pool, horseId);
    if (h.is_house || !h.owner_id) throw notFound("Horse");
    const [partners, offer, manager] = await Promise.all([
      this.partners(this.db.pool, horseId),
      this.db.one<OfferRow>("SELECT * FROM share_offers WHERE horse_id = $1", [horseId]),
      this.db.one<{ name: string }>(
        "SELECT COALESCE(first_name, username, 'Owner') AS name FROM users WHERE id = $1",
        [h.owner_id],
      ),
    ]);
    const sold = partners.reduce((s, p) => s + p.shares, 0);
    return {
      horseId,
      totalShares: this.cfg.totalShares,
      maxPartnerShares: this.cfg.maxPartnerShares,
      managerId: h.owner_id,
      managerName: manager?.name ?? "Owner",
      managerShares: this.cfg.totalShares - sold,
      partners: partners.map((p): SyndicatePartnerDto => ({
        userId: p.holder_id,
        name: p.name,
        shares: p.shares,
      })),
      offer:
        offer && offer.manager_id === h.owner_id
          ? { pricePerShare: offer.price_per_share, available: offer.available }
          : null,
      myShares: partners.find((p) => p.holder_id === viewerId)?.shares ?? 0,
      priceBand: viewerId === h.owner_id ? this.band(h) : null,
      feeRate: this.cfg.feeRate,
    };
  }

  /** Put shares up for sale (replaces any current offer). */
  async offer(managerId: string, horseId: string, req: ShareOfferRequest): Promise<SyndicateDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const h = await this.horses.lockOwned(c, horseId, managerId);
      if (h.status === "LISTED") throw conflict("HORSE_BUSY", "This horse is on the market");
      const band = this.band(h);
      if (req.pricePerShare < band.min || req.pricePerShare > band.max)
        throw conflict("PRICE_OUT_OF_RANGE", `Price per share must be ${band.min}–${band.max}`, band);
      const sold = await this.partnerShares(c, horseId);
      if (sold + req.shares > this.cfg.maxPartnerShares)
        throw conflict(
          "TOO_MANY_SHARES",
          `At most ${this.cfg.maxPartnerShares} of ${this.cfg.totalShares} shares may belong to partners`,
        );
      await c.query(
        `INSERT INTO share_offers (horse_id, manager_id, price_per_share, available, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5)
         ON CONFLICT (horse_id) DO UPDATE SET manager_id = EXCLUDED.manager_id, price_per_share = EXCLUDED.price_per_share,
           available = EXCLUDED.available, updated_at = EXCLUDED.updated_at`,
        [horseId, managerId, req.pricePerShare, req.shares, now],
      );
    });
    return this.view(horseId, managerId);
  }

  async withdraw(managerId: string, horseId: string): Promise<SyndicateDto> {
    await this.db.query("DELETE FROM share_offers WHERE horse_id = $1 AND manager_id = $2", [
      horseId,
      managerId,
    ]);
    return this.view(horseId, managerId);
  }

  async buy(buyerId: string, horseId: string, shares: number): Promise<SyndicateDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const o = await row<OfferRow>(c, "SELECT * FROM share_offers WHERE horse_id = $1 FOR UPDATE", [
        horseId,
      ]);
      if (!o) throw notFound("Share offer");
      const h = await getHorse(c, horseId, true);
      if (h.owner_id !== o.manager_id || h.retired_at) {
        await c.query("DELETE FROM share_offers WHERE horse_id = $1", [horseId]);
        throw notFound("Share offer");
      }
      if (buyerId === o.manager_id) throw conflict("SELF_TRADE", "You already manage this horse");
      if (shares > o.available)
        throw conflict("NOT_ENOUGH_SHARES", `Only ${o.available} shares are on offer`);
      if ((await this.partnerShares(c, horseId)) + shares > this.cfg.maxPartnerShares)
        throw conflict("TOO_MANY_SHARES", "No more shares can be sold for this horse");
      const price = o.price_per_share * shares;
      const fee = Math.floor(price * this.cfg.feeRate);
      await this.ledger.post(c, {
        idempotencyKey: `syndicate:${horseId}:buy:${randomUUID()}`,
        type: "SYNDICATE_SHARE_SALE",
        reason: `${shares} share${shares === 1 ? "" : "s"} of ${h.name}`,
        actorId: buyerId,
        metadata: { horseId, manager: o.manager_id, buyer: buyerId, shares, price },
        entries: [
          { account: { user: buyerId, currency: "CREDITS" }, amount: -price },
          { account: { user: o.manager_id, currency: "CREDITS" }, amount: price - fee },
          ...(fee > 0
            ? [{ account: { system: "MARKET_FEES" as const, currency: "CREDITS" as const }, amount: fee }]
            : []),
        ],
      });
      await c.query(
        `INSERT INTO horse_shares (horse_id, holder_id, shares, cost_paid, acquired_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (horse_id, holder_id) DO UPDATE
           SET shares = horse_shares.shares + EXCLUDED.shares, cost_paid = horse_shares.cost_paid + EXCLUDED.cost_paid`,
        [horseId, buyerId, shares, price, now],
      );
      if (o.available === shares) await c.query("DELETE FROM share_offers WHERE horse_id = $1", [horseId]);
      else
        await c.query(
          "UPDATE share_offers SET available = available - $2, updated_at = $3 WHERE horse_id = $1",
          [horseId, shares, now],
        );
      await this.events.emit(c, {
        type: "syndicate_shares_sold",
        aggregateType: "horse",
        aggregateId: horseId,
        actorId: buyerId,
        payload: { userId: o.manager_id, horseName: h.name, shares, price },
      });
    });
    return this.view(horseId, buyerId);
  }

  /** The manager buys every share back at the price its holder paid, ending the syndicate. */
  async dissolve(managerId: string, horseId: string): Promise<SyndicateDto> {
    await this.db.tx(async (c) => {
      const h = await this.horses.lockOwned(c, horseId, managerId);
      const partners = await rows<ShareRow>(
        c,
        "SELECT holder_id, '' AS name, shares, cost_paid FROM horse_shares WHERE horse_id = $1 FOR UPDATE",
        [horseId],
      );
      if (partners.length === 0) throw conflict("NOT_SYNDICATED", "This horse has no partners");
      const id = randomUUID();
      for (const p of partners) {
        if (p.cost_paid > 0)
          await this.ledger.post(c, {
            idempotencyKey: `syndicate:${horseId}:buyback:${id}:${p.holder_id}`,
            type: "SYNDICATE_BUYBACK",
            reason: `Buy-back of ${p.shares} share${p.shares === 1 ? "" : "s"} of ${h.name}`,
            actorId: managerId,
            metadata: { horseId, manager: managerId, holder: p.holder_id, shares: p.shares },
            entries: [
              { account: { user: managerId, currency: "CREDITS" }, amount: -p.cost_paid },
              { account: { user: p.holder_id, currency: "CREDITS" }, amount: p.cost_paid },
            ],
          });
      }
      await c.query("DELETE FROM horse_shares WHERE horse_id = $1", [horseId]);
      await c.query("DELETE FROM share_offers WHERE horse_id = $1", [horseId]);
    });
    return this.view(horseId, managerId);
  }

  /**
   * Credit prize money for a horse: each partner gets floor(amount × shares / total) (key suffixed
   * `:share:<holder>`, type `<type>_SHARE`); the manager receives the rest under the original key.
   */
  async splitCredit(
    c: Queryable,
    a: {
      horseId: string;
      managerId: string;
      amount: number;
      source: SystemAccount;
      key: string;
      type: string;
      reason: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const total = this.cfg.totalShares;
    const partners = await rows<{ holder_id: string; shares: number }>(
      c,
      "SELECT holder_id, shares FROM horse_shares WHERE horse_id = $1 ORDER BY holder_id",
      [a.horseId],
    );
    let rest = a.amount;
    for (const p of partners) {
      const part = Math.floor((a.amount * p.shares) / total);
      if (part <= 0) continue;
      rest -= part;
      await this.ledger.credit(c, {
        userId: p.holder_id,
        currency: "CREDITS",
        amount: part,
        source: a.source,
        key: `${a.key}:share:${p.holder_id}`,
        type: `${a.type}_SHARE`,
        reason: a.reason,
        metadata: { ...a.metadata, horseId: a.horseId, shares: p.shares },
      });
    }
    if (rest > 0)
      await this.ledger.credit(c, {
        userId: a.managerId,
        currency: "CREDITS",
        amount: rest,
        source: a.source,
        key: a.key,
        type: a.type,
        reason: a.reason,
        metadata: a.metadata,
      });
  }

  async offers(limit = 30): Promise<ShareOfferDto[]> {
    const now = this.clock.now();
    const list = await this.db.query<
      HorseRow & { price_per_share: number; available: number; manager_name: string }
    >(
      `SELECT h.*, o.price_per_share, o.available, COALESCE(u.first_name, u.username, 'Owner') AS manager_name
         FROM share_offers o JOIN horses h ON h.id = o.horse_id AND h.owner_id = o.manager_id AND h.retired_at IS NULL
         JOIN users u ON u.id = o.manager_id
        ORDER BY o.updated_at DESC LIMIT $1`,
      [limit],
    );
    return list.map((r) => ({
      horse: this.horses.summary(r, now, r.manager_name),
      managerName: r.manager_name,
      pricePerShare: r.price_per_share,
      available: r.available,
      totalShares: this.cfg.totalShares,
    }));
  }

  async mine(holderId: string): Promise<MyShareDto[]> {
    const now = this.clock.now();
    const list = await this.db.query<
      HorseRow & { held: number; cost: number; earned: number; owner_name: string }
    >(
      `SELECT h.*, s.shares AS held, s.cost_paid::bigint AS cost,
              COALESCE(u.first_name, u.username, 'Owner') AS owner_name,
              COALESCE((SELECT sum(e.amount) FROM ledger_transactions t
                          JOIN ledger_entries e ON e.tx_id = t.id
                          JOIN accounts a ON a.id = e.account_id AND a.owner_type = 'USER' AND a.owner_id = $1
                         WHERE t.type LIKE '%\\_SHARE' AND t.metadata->>'horseId' = h.id::text), 0)::bigint AS earned
         FROM horse_shares s JOIN horses h ON h.id = s.horse_id LEFT JOIN users u ON u.id = h.owner_id
        WHERE s.holder_id = $1 ORDER BY s.acquired_at DESC`,
      [holderId],
    );
    return list.map((r) => ({
      horse: this.horses.summary(r, now, r.owner_name),
      shares: r.held,
      totalShares: this.cfg.totalShares,
      costPaid: Number(r.cost),
      earned: Number(r.earned),
    }));
  }
}
