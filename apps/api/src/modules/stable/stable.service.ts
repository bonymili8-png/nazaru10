import { Injectable } from "@nestjs/common";
import type { StableDto } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { QuestsService } from "../quests/quests.service.js";

interface StableRow {
  id: string;
  owner_id: string;
  name: string;
  level: number;
}

@Injectable()
export class StableService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly quests: QuestsService,
    private readonly clock: Clock,
  ) {}

  async byOwner(c: Queryable, ownerId: string, lock = false): Promise<StableRow> {
    const s = await row<StableRow>(
      c,
      `SELECT id, owner_id, name, level FROM stables WHERE owner_id = $1${lock ? " FOR UPDATE" : ""}`,
      [ownerId],
    );
    if (!s) throw notFound("Stable");
    return s;
  }

  capacity(level: number): number {
    const caps = this.config.get().economy.stableCapacity;
    return caps[Math.min(level, caps.length) - 1]!;
  }

  /** Throws if the owner has no free box. Call with the stable row locked. */
  async assertHasRoom(c: Queryable, stable: StableRow): Promise<void> {
    const r = await row<{ n: number }>(
      c,
      "SELECT count(*)::int AS n FROM horses WHERE owner_id = $1 AND retired_at IS NULL",
      [stable.owner_id],
    );
    if (r!.n >= this.capacity(stable.level)) {
      throw conflict("STABLE_FULL", "Your stable is full — upgrade it to house more horses");
    }
  }

  async view(ownerId: string, c: Queryable = this.db.pool): Promise<StableDto> {
    const s = await this.byOwner(c, ownerId);
    const n = await row<{ n: number }>(
      c,
      "SELECT count(*)::int AS n FROM horses WHERE owner_id = $1 AND retired_at IS NULL",
      [ownerId],
    );
    const rep = await row<{ balance: number }>(
      c,
      "SELECT balance FROM accounts WHERE owner_type = 'USER' AND owner_id = $1 AND currency = 'REPUTATION'",
      [ownerId],
    );
    const costs = this.config.get().economy.stableUpgradeCost;
    return {
      id: s.id,
      name: s.name,
      level: s.level,
      capacity: this.capacity(s.level),
      horseCount: n!.n,
      reputation: rep?.balance ?? 0,
      nextUpgradeCost: costs[s.level - 1] ?? null,
    };
  }

  async upgrade(ownerId: string): Promise<StableDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const s = await this.byOwner(c, ownerId, true);
      const cost = this.config.get().economy.stableUpgradeCost[s.level - 1];
      if (cost === undefined) throw conflict("MAX_LEVEL", "Stable is already at maximum level");
      await this.ledger.debit(c, {
        userId: ownerId,
        currency: "CREDITS",
        amount: cost,
        sink: "STABLE_UPGRADE",
        key: `stable:${s.id}:upgrade:${s.level + 1}`,
        type: "STABLE_UPGRADE",
        reason: `Stable level ${s.level + 1}`,
      });
      await c.query("UPDATE stables SET level = level + 1, updated_at = $2 WHERE id = $1", [s.id, now]);
      await this.events.emit(c, {
        type: "stable_upgraded",
        aggregateType: "stable",
        aggregateId: s.id,
        actorId: ownerId,
        payload: { level: s.level + 1 },
      });
      await this.quests.complete(c, ownerId, "UPGRADE_STABLE", now);
    });
    return this.view(ownerId);
  }

  async rename(ownerId: string, name: string): Promise<StableDto> {
    await this.db.query("UPDATE stables SET name = $2, updated_at = now() WHERE owner_id = $1", [
      ownerId,
      name,
    ]);
    return this.view(ownerId);
  }
}
