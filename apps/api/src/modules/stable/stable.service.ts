import { Injectable } from "@nestjs/common";
import type { FacilityDto, StableDto } from "@thoroughline/contracts";
import {
  FACILITY_TYPES,
  facilityEffect,
  facilityMaxLevel,
  facilityRequiredStableLevel,
  facilityUpgradeCost,
  type FacilityLevels,
  type FacilityType,
} from "@thoroughline/engine";
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
  training_track: number;
  vet_clinic: number;
}

const COLUMN: Record<FacilityType, "training_track" | "vet_clinic"> = {
  TRAINING_TRACK: "training_track",
  VET_CLINIC: "vet_clinic",
};

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
      `SELECT id, owner_id, name, level, training_track, vet_clinic FROM stables WHERE owner_id = $1${lock ? " FOR UPDATE" : ""}`,
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
      facilities: this.facilityDtos(s),
    };
  }

  levels(s: StableRow): FacilityLevels {
    return { TRAINING_TRACK: s.training_track, VET_CLINIC: s.vet_clinic };
  }

  private facilityDtos(s: StableRow): FacilityDto[] {
    const cfg = this.config.get();
    return FACILITY_TYPES.map((type) => {
      const level = this.levels(s)[type];
      const nextCost = facilityUpgradeCost(type, level, cfg);
      const f = cfg.facilities[type];
      return {
        type,
        level,
        maxLevel: facilityMaxLevel(type, cfg),
        nextCost,
        requiresStableLevel: nextCost === null ? null : facilityRequiredStableLevel(level + 1, cfg),
        gainPct: Math.round(f.gainPerLevel * level * 1000) / 10,
        injuryReductionPct: Math.round(f.injuryReductionPerLevel * level * 1000) / 10,
      };
    });
  }

  /** Combined facility effect on training for an owner's stable. */
  async trainingEffect(c: Queryable, ownerId: string) {
    return facilityEffect(this.levels(await this.byOwner(c, ownerId)), this.config.get());
  }

  async build(ownerId: string, type: FacilityType): Promise<StableDto> {
    const now = this.clock.now();
    const cfg = this.config.get();
    await this.db.tx(async (c) => {
      const s = await this.byOwner(c, ownerId, true);
      const current = this.levels(s)[type];
      const cost = facilityUpgradeCost(type, current, cfg);
      if (cost === null) throw conflict("MAX_LEVEL", "This facility is already at maximum level");
      const needs = facilityRequiredStableLevel(current + 1, cfg);
      if (s.level < needs)
        throw conflict("STABLE_LEVEL_TOO_LOW", `Upgrade your stable to level ${needs} first`);
      await this.ledger.debit(c, {
        userId: ownerId,
        currency: "CREDITS",
        amount: cost,
        sink: "FACILITIES",
        key: `stable:${s.id}:facility:${type}:${current + 1}`,
        type: "FACILITY_BUILD",
        reason: `${type === "TRAINING_TRACK" ? "Training track" : "Vet clinic"} level ${current + 1}`,
      });
      await c.query(`UPDATE stables SET ${COLUMN[type]} = $2, updated_at = $3 WHERE id = $1`, [
        s.id,
        current + 1,
        now,
      ]);
      await this.events.emit(c, {
        type: "facility_built",
        aggregateType: "stable",
        aggregateId: s.id,
        actorId: ownerId,
        payload: { type, level: current + 1, cost },
      });
    });
    return this.view(ownerId);
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
