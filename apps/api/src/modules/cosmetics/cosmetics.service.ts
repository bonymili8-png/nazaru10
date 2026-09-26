import { Injectable } from "@nestjs/common";
import { type CosmeticsDto, SILK_PATTERNS, type SilkPattern, type Silks } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";

export const silkItem = (p: SilkPattern | string) => `silk:${p}`;

/**
 * Cosmetics are the main gem sink: they change how a stable looks (racing silks on race cards and
 * in the live viewer) and never how it performs.
 */
@Injectable()
export class CosmeticsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  private price(p: SilkPattern): number {
    return this.config.get().cosmetics.silkPatternPrices[p] ?? 0;
  }

  async view(userId: string): Promise<CosmeticsDto> {
    const [stable, owned, balances] = await Promise.all([
      this.db.one<{ silks: Silks }>("SELECT silks FROM stables WHERE owner_id = $1", [userId]),
      this.db.query<{ item: string }>("SELECT item FROM owned_cosmetics WHERE user_id = $1", [userId]),
      this.ledger.balances(userId),
    ]);
    if (!stable) throw notFound("Stable");
    const have = new Set(owned.map((o) => o.item));
    return {
      silks: stable.silks,
      patterns: SILK_PATTERNS.map((pattern) => {
        const price = this.price(pattern);
        return {
          pattern,
          priceGems: price < 0 ? null : price,
          owned: price === 0 || have.has(silkItem(pattern)),
        };
      }),
      gems: balances.GEMS,
    };
  }

  async unlockPattern(userId: string, pattern: SilkPattern): Promise<CosmeticsDto> {
    const price = this.price(pattern);
    if (price < 0) throw conflict("PASS_EXCLUSIVE", "This pattern is earned on the Racing Pass");
    if (price > 0) {
      await this.db.tx(async (c) => {
        const inserted = await c.query(
          "INSERT INTO owned_cosmetics (user_id, item, acquired_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [userId, silkItem(pattern), this.clock.now()],
        );
        if (inserted.rowCount === 0) throw conflict("ALREADY_OWNED", "You already own this pattern");
        await this.ledger.debit(c, {
          userId,
          currency: "GEMS",
          amount: price,
          sink: "COSMETICS",
          key: `cosmetic:${userId}:${silkItem(pattern)}`,
          type: "COSMETIC_UNLOCK",
          reason: `Racing silks — ${pattern.toLowerCase()}`,
          metadata: { item: silkItem(pattern) },
        });
        await this.events.emit(c, {
          type: "cosmetic_unlocked",
          aggregateType: "user",
          aggregateId: userId,
          actorId: userId,
          payload: { item: silkItem(pattern), price },
        });
      });
    }
    return this.view(userId);
  }

  async setSilks(userId: string, silks: Silks): Promise<CosmeticsDto> {
    if (this.price(silks.pattern) !== 0) {
      const owned = await row<{ item: string }>(
        this.db.pool,
        "SELECT item FROM owned_cosmetics WHERE user_id = $1 AND item = $2",
        [userId, silkItem(silks.pattern)],
      );
      if (!owned) throw conflict("NOT_OWNED", "Unlock this pattern first");
    }
    await this.db.query("UPDATE stables SET silks = $2, updated_at = now() WHERE owner_id = $1", [
      userId,
      JSON.stringify({ pattern: silks.pattern, primary: silks.primary, secondary: silks.secondary }),
    ]);
    return this.view(userId);
  }
}
