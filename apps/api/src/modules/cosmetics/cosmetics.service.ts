import { Injectable } from "@nestjs/common";
import {
  CLOTH_PATTERNS,
  type ClothPattern,
  type CosmeticsDto,
  CREST_ICONS,
  type Crest,
  type CrestIcon,
  SILK_PATTERNS,
  type SaddleCloth,
  type SilkPattern,
  type Silks,
} from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";

export const silkItem = (p: SilkPattern | string) => `silk:${p}`;
export const crestItem = (i: CrestIcon | string) => `crest:${i}`;
export const clothItem = (p: ClothPattern | string) => `cloth:${p}`;

/**
 * Cosmetics are the main gem sink: they change how a stable looks (racing silks on race cards and
 * in the live viewer, the crest beside the stable name) and never how it performs.
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

  private crestPrice(i: CrestIcon): number {
    return this.config.get().cosmetics.crestIconPrices[i] ?? 0;
  }

  private clothPrice(p: ClothPattern): number {
    return this.config.get().cosmetics.clothPatternPrices[p] ?? 0;
  }

  async view(userId: string): Promise<CosmeticsDto> {
    const [stable, owned, balances] = await Promise.all([
      this.db.one<{ silks: Silks; crest: Crest }>("SELECT silks, crest FROM stables WHERE owner_id = $1", [
        userId,
      ]),
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
      crest: stable.crest,
      crestIcons: CREST_ICONS.map((icon) => {
        const price = this.crestPrice(icon);
        return { icon, priceGems: price, owned: price <= 0 || have.has(crestItem(icon)) };
      }),
      clothPatterns: CLOTH_PATTERNS.map((pattern) => {
        const price = this.clothPrice(pattern);
        return { pattern, priceGems: price, owned: price <= 0 || have.has(clothItem(pattern)) };
      }),
      gems: balances.GEMS,
    };
  }

  async unlockPattern(userId: string, pattern: SilkPattern): Promise<CosmeticsDto> {
    const price = this.price(pattern);
    if (price < 0) throw conflict("PASS_EXCLUSIVE", "This pattern is earned on the Racing Pass");
    if (price > 0)
      await this.buy(userId, silkItem(pattern), price, `Racing silks — ${pattern.toLowerCase()}`);
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

  async unlockCrestIcon(userId: string, icon: CrestIcon): Promise<CosmeticsDto> {
    const price = this.crestPrice(icon);
    if (price > 0) await this.buy(userId, crestItem(icon), price, `Stable crest — ${icon.toLowerCase()}`);
    return this.view(userId);
  }

  async setCrest(userId: string, crest: Crest): Promise<CosmeticsDto> {
    if (this.crestPrice(crest.icon) > 0) {
      const owned = await row<{ item: string }>(
        this.db.pool,
        "SELECT item FROM owned_cosmetics WHERE user_id = $1 AND item = $2",
        [userId, crestItem(crest.icon)],
      );
      if (!owned) throw conflict("NOT_OWNED", "Unlock this emblem first");
    }
    await this.db.query("UPDATE stables SET crest = $2, updated_at = now() WHERE owner_id = $1", [
      userId,
      JSON.stringify({ shape: crest.shape, icon: crest.icon, field: crest.field, charge: crest.charge }),
    ]);
    return this.view(userId);
  }

  async unlockClothPattern(userId: string, pattern: ClothPattern): Promise<CosmeticsDto> {
    const price = this.clothPrice(pattern);
    if (price > 0)
      await this.buy(userId, clothItem(pattern), price, `Saddle cloth — ${pattern.toLowerCase()}`);
    return this.view(userId);
  }

  /** Dress one of the owner's horses in a saddle cloth (pattern must be unlocked). */
  async setCloth(userId: string, horseId: string, cloth: SaddleCloth): Promise<SaddleCloth> {
    if (this.clothPrice(cloth.pattern) > 0) {
      const owned = await row<{ item: string }>(
        this.db.pool,
        "SELECT item FROM owned_cosmetics WHERE user_id = $1 AND item = $2",
        [userId, clothItem(cloth.pattern)],
      );
      if (!owned) throw conflict("NOT_OWNED", "Unlock this pattern first");
    }
    const value = { pattern: cloth.pattern, color: cloth.color, trim: cloth.trim };
    const r = await this.db.query(
      "UPDATE horses SET cloth = $3 WHERE id = $1 AND owner_id = $2 AND retired_at IS NULL RETURNING id",
      [horseId, userId, JSON.stringify(value)],
    );
    if (r.length === 0) throw notFound("Horse");
    return value;
  }

  /** Pay gems for a cosmetic item exactly once (the ownership row and the debit commit together). */
  private async buy(userId: string, item: string, price: number, reason: string): Promise<void> {
    await this.db.tx(async (c) => {
      const inserted = await c.query(
        "INSERT INTO owned_cosmetics (user_id, item, acquired_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [userId, item, this.clock.now()],
      );
      if (inserted.rowCount === 0) throw conflict("ALREADY_OWNED", "You already own this item");
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: price,
        sink: "COSMETICS",
        key: `cosmetic:${userId}:${item}`,
        type: "COSMETIC_UNLOCK",
        reason,
        metadata: { item },
      });
      await this.events.emit(c, {
        type: "cosmetic_unlocked",
        aggregateType: "user",
        aggregateId: userId,
        actorId: userId,
        payload: { item, price },
      });
    });
  }
}
