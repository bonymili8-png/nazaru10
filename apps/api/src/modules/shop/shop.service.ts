import { Injectable } from "@nestjs/common";
import type { ShopHorseDto } from "@thoroughline/contracts";
import { horseValuation, type Rarity, Rng } from "@thoroughline/engine";
import { randomUUID } from "node:crypto";
import { Clock } from "../../common/clock.js";
import { Db, row } from "../../common/db.js";
import { notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { HorseFactory } from "../horses/horse.factory.js";
import { type HorseRow, transferHorse } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { OFF_POOL } from "../races/house.service.js";
import { QuestsService } from "../quests/quests.service.js";
import { StableService } from "../stable/stable.service.js";

const CATALOG_SIZE = 8;
const LISTING_HOURS = 12;

/** Primary horse sales ("sales ring"): house-bred horses sold at the valuation price (credit sink). */
@Injectable()
export class ShopService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly factory: HorseFactory,
    private readonly horses: HorsesService,
    private readonly stables: StableService,
    private readonly ledger: LedgerService,
    private readonly quests: QuestsService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  /**
   * Keep the catalogue stocked. Stale listings leave the shop but not into the racing pool: sale
   * horses span every quality (0.2–0.75, limited drops higher) and would be over-strong Class 5
   * rivals.
   */
  async restock(): Promise<number> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(72410002)");
      await c.query(
        `UPDATE horses SET sale_price = NULL, house_class = $2
          WHERE is_house AND sale_price IS NOT NULL AND house_class <> 'LIMITED' AND created_at < $1`,
        [new Date(now.getTime() - LISTING_HOURS * 3_600_000), OFF_POOL],
      );
      // Limited drops leave the shop at their own end time.
      await c.query(
        `UPDATE horses SET sale_price = NULL, sale_ends_at = NULL, house_class = $2
          WHERE is_house AND house_class = 'LIMITED' AND sale_ends_at <= $1`,
        [now, OFF_POOL],
      );
      const r = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM horses WHERE is_house AND sale_price IS NOT NULL AND house_class <> 'LIMITED'",
      );
      let created = 0;
      const rng = new Rng(randomUUID());
      for (let i = r!.n; i < CATALOG_SIZE; i++) {
        const age = rng.float(2, 4.5);
        await this.factory.generate(c, {
          quality: rng.float(0.2, 0.75),
          age,
          isHouse: true,
          houseClass: "SHOP",
          salePrice: ({ genome, attributes }) => horseValuation(genome, attributes, age),
          now,
        });
        created++;
      }
      return created;
    });
  }

  async catalog(): Promise<ShopHorseDto[]> {
    const now = this.clock.now();
    const list = await this.db.query<HorseRow & { sale_ends_at: Date | null }>(
      `SELECT * FROM horses WHERE is_house AND sale_price IS NOT NULL
          AND (house_class <> 'LIMITED' OR sale_ends_at > $1)
        ORDER BY (house_class = 'LIMITED') DESC, sale_price`,
      [now],
    );
    return list.map((h) => ({
      ...this.horses.marketCard(h, now, h.sale_price!),
      limitedUntil: h.house_class === "LIMITED" ? (h.sale_ends_at?.toISOString() ?? null) : null,
    }));
  }

  /** A limited horse drop (live ops): a generated horse of the chosen rarity, for sale until `hours`. */
  async createLimited(
    actorId: string,
    input: { rarity: Rarity; quality: number; price: number; hours: number },
  ): Promise<ShopHorseDto> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const h = await this.factory.generate(c, {
        quality: input.quality,
        rarity: input.rarity,
        age: 2.5,
        isHouse: true,
        houseClass: "LIMITED",
        salePrice: () => input.price,
        now,
      });
      const endsAt = new Date(now.getTime() + input.hours * 3_600_000);
      await c.query("UPDATE horses SET sale_ends_at = $2 WHERE id = $1", [h.id, endsAt]);
      await this.events.emit(c, {
        type: "limited_horse_listed",
        aggregateType: "horse",
        aggregateId: h.id,
        actorId,
        payload: { rarity: input.rarity, price: input.price, endsAt: endsAt.toISOString() },
      });
      return { ...this.horses.marketCard(h, now, input.price), limitedUntil: endsAt.toISOString() };
    });
  }

  async buy(userId: string, horseId: string): Promise<HorseRow> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const stable = await this.stables.byOwner(c, userId, true);
      const h = await row<HorseRow>(c, "SELECT * FROM horses WHERE id = $1 FOR UPDATE", [horseId]);
      if (!h || !h.is_house || h.sale_price === null) throw notFound("Listing");
      if (h.house_class === "LIMITED" && (!h.sale_ends_at || h.sale_ends_at <= now))
        throw notFound("Listing");
      await this.stables.assertHasRoom(c, stable);
      await this.ledger.debit(c, {
        userId,
        currency: "CREDITS",
        amount: h.sale_price,
        sink: "HORSE_SALES",
        key: `shop:buy:${horseId}`,
        type: "HORSE_PURCHASE",
        reason: `Bought ${h.name}`,
        metadata: { horseId },
      });
      const bought = await transferHorse(
        c,
        h,
        { userId, stableId: stable.id },
        "PRIMARY_SALE",
        h.sale_price,
        now,
      );
      await this.quests.complete(c, userId, "BUY_HORSE", now);
      await this.events.emit(c, {
        type: "horse_acquired",
        aggregateType: "horse",
        aggregateId: horseId,
        actorId: userId,
        payload: { price: h.sale_price },
      });
      return bought;
    });
  }
}
