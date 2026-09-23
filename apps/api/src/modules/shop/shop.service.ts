import { Injectable } from "@nestjs/common";
import type { ShopHorseDto } from "@thoroughline/contracts";
import { ageInYears, horseValuation, potentialStars, SURFACES } from "@thoroughline/engine";
import { Rng } from "@thoroughline/engine";
import { randomUUID } from "node:crypto";
import { Clock } from "../../common/clock.js";
import { Db, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { HorseFactory } from "../horses/horse.factory.js";
import { type HorseRow, recordOwnership } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
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

  /** Keep the catalogue stocked; stale listings rotate into the house racing pool. */
  async restock(): Promise<number> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(72410002)");
      await c.query(
        `UPDATE horses SET sale_price = NULL, house_class = 'CLASS_5'
          WHERE is_house AND sale_price IS NOT NULL AND created_at < $1`,
        [new Date(now.getTime() - LISTING_HOURS * 3_600_000)],
      );
      const r = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM horses WHERE is_house AND sale_price IS NOT NULL",
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
    const cfg = this.config.get();
    const list = await this.db.query<HorseRow>(
      "SELECT * FROM horses WHERE is_house AND sale_price IS NOT NULL ORDER BY sale_price",
    );
    return list.map((h) => {
      const surfaces = h.genome.aptitudes.surface;
      return {
        ...this.horses.summary(h, now),
        price: h.sale_price!,
        potentialStars: potentialStars(h.genome),
        optimalDistance: h.genome.aptitudes.optimalDistance,
        favouriteSurface: [...SURFACES].sort((a, b) => surfaces[b] - surfaces[a])[0]!,
        age: Math.round(ageInYears(h.birth_at, now, cfg) * 10) / 10,
      };
    });
  }

  async buy(userId: string, horseId: string): Promise<HorseRow> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const stable = await this.stables.byOwner(c, userId, true);
      const h = await row<HorseRow>(c, "SELECT * FROM horses WHERE id = $1 FOR UPDATE", [horseId]);
      if (!h || !h.is_house || h.sale_price === null) throw notFound("Listing");
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
      const res = await c.query<HorseRow>(
        `UPDATE horses SET owner_id = $2, stable_id = $3, is_house = false, house_class = NULL, sale_price = NULL,
                status = 'IDLE', updated_at = $4 WHERE id = $1 RETURNING *`,
        [horseId, userId, stable.id, now],
      );
      await recordOwnership(c, horseId, null, userId, "PRIMARY_SALE", h.sale_price);
      await this.quests.complete(c, userId, "BUY_HORSE", now);
      await this.events.emit(c, {
        type: "horse_acquired",
        aggregateType: "horse",
        aggregateId: horseId,
        actorId: userId,
        payload: { price: h.sale_price },
      });
      if (!res.rows[0]) throw conflict("PURCHASE_FAILED", "Purchase failed");
      return res.rows[0];
    });
  }
}
