import { Injectable } from "@nestjs/common";
import type { Crest, FacilityDto, GearDto, MasteryDto, StableDto } from "@thoroughline/contracts";
import {
  MASTERY_TRACKS,
  type MasteryPerks,
  type MasteryXp,
  masteryPerks,
  masteryProgress,
  FACILITY_TYPES,
  GEAR_ITEMS,
  gearRepairCost,
  type GearItem,
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
  crest: Crest;
  gear: GearItem[];
  gear_wear: Record<string, number>;
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
      `SELECT id, owner_id, name, level, training_track, vet_clinic, crest, gear, gear_wear FROM stables WHERE owner_id = $1${lock ? " FOR UPDATE" : ""}`,
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
      renameGems: {
        stable: this.config.get().economy.renameStableGems,
        horse: this.config.get().economy.renameHorseGems,
      },
      facilities: this.facilityDtos(s),
      gear: this.gearDtos(s),
      crest: s.crest,
      mastery: this.masteryDto(await this.masteryXp(c, ownerId)),
    };
  }

  /** Experience behind stable mastery, counted from what the owner actually did. */
  async masteryXp(c: Queryable, ownerId: string): Promise<MasteryXp> {
    const r = await row<MasteryXp>(
      c,
      `SELECT
         (SELECT count(*)::int FROM training_sessions WHERE owner_id = $1 AND status = 'COMPLETED') AS trainings,
         (SELECT count(*)::int FROM race_entries WHERE owner_id = $1 AND status = 'RAN') AS starts,
         (SELECT count(*)::int FROM race_entries WHERE owner_id = $1 AND status = 'RAN' AND position <= 3) AS podiums,
         (SELECT count(*)::int FROM breeding_events WHERE owner_id = $1 AND status = 'DELIVERED') AS foals`,
      [ownerId],
    );
    return r!;
  }

  /** The owner's current mastery edges (training gain, post-race fatigue, gestation). */
  async masteryPerks(c: Queryable, ownerId: string): Promise<MasteryPerks> {
    return masteryPerks(await this.masteryXp(c, ownerId), this.config.get());
  }

  private masteryDto(xp: MasteryXp): MasteryDto {
    const cfg = this.config.get();
    const m = cfg.mastery;
    const perLevel = {
      TRAINING: m.trainingGainPerLevel,
      RACING: m.raceFatigueReliefPerLevel,
      BREEDING: m.gestationCutPerLevel,
    } as const;
    return {
      tracks: MASTERY_TRACKS.map((track) => {
        const p = masteryProgress(track, xp, cfg);
        return {
          ...p,
          bonusPct: Math.round(p.level * perLevel[track] * 1000) / 10,
          perLevelPct: Math.round(perLevel[track] * 1000) / 10,
        };
      }),
    };
  }

  levels(s: StableRow): FacilityLevels {
    return { TRAINING_TRACK: s.training_track, VET_CLINIC: s.vet_clinic };
  }

  private gearDtos(s: StableRow): GearDto[] {
    const cfg = this.config.get();
    return GEAR_ITEMS.map((item) => {
      const owned = s.gear.includes(item);
      const used = s.gear_wear[item] ?? 0;
      return {
        item,
        cost: cfg.equipment[item].cost,
        mods: cfg.equipment[item].mods,
        owned,
        racesLeft: owned ? Math.max(0, cfg.gearWear.races - used) : null,
        repairCost: owned ? gearRepairCost(item, used, cfg) : 0,
      };
    });
  }

  /** Buy a race-day gear item for the stable (credits, sink EQUIPMENT; once per item). */
  async buyGear(ownerId: string, item: GearItem): Promise<StableDto> {
    const now = this.clock.now();
    const cost = this.config.get().equipment[item].cost;
    await this.db.tx(async (c) => {
      const s = await this.byOwner(c, ownerId, true);
      if (s.gear.includes(item)) throw conflict("GEAR_OWNED", "Your stable already has this gear");
      await this.ledger.debit(c, {
        userId: ownerId,
        currency: "CREDITS",
        amount: cost,
        sink: "EQUIPMENT",
        key: `stable:${s.id}:gear:${item}`,
        type: "GEAR_PURCHASE",
        reason: `Race gear: ${item}`,
      });
      await c.query(
        "UPDATE stables SET gear = array_append(gear, $2), gear_wear = gear_wear - $2, updated_at = $3 WHERE id = $1",
        [s.id, item, now],
      );
      await this.events.emit(c, {
        type: "gear_bought",
        aggregateType: "stable",
        aggregateId: s.id,
        actorId: ownerId,
        payload: { item, cost },
      });
    });
    return this.view(ownerId);
  }

  /** Restore a worn item to full (cost proportional to wear; sink EQUIPMENT). */
  async repairGear(ownerId: string, item: GearItem): Promise<StableDto> {
    const now = this.clock.now();
    const cfg = this.config.get();
    await this.db.tx(async (c) => {
      const s = await this.byOwner(c, ownerId, true);
      if (!s.gear.includes(item)) throw conflict("GEAR_NOT_OWNED", "Buy this gear for your stable first");
      const used = s.gear_wear[item] ?? 0;
      const cost = gearRepairCost(item, used, cfg);
      if (cost <= 0) throw conflict("GEAR_NEW", "This gear shows no wear yet");
      await this.ledger.debit(c, {
        userId: ownerId,
        currency: "CREDITS",
        amount: cost,
        sink: "EQUIPMENT",
        key: `stable:${s.id}:gear:${item}:repair:${now.getTime()}`,
        type: "GEAR_REPAIR",
        reason: `Race gear repaired: ${item}`,
        metadata: { item, used },
      });
      await c.query("UPDATE stables SET gear_wear = gear_wear - $2, updated_at = $3 WHERE id = $1", [
        s.id,
        item,
        now,
      ]);
    });
    return this.view(ownerId);
  }

  /**
   * One race run with an item: count the wear and retire it when used up. Call inside the race
   * settlement transaction. Returns true when the item wore out.
   */
  async wearGear(c: Queryable, ownerId: string, item: GearItem): Promise<boolean> {
    const races = this.config.get().gearWear.races;
    const r = await row<{ used: number }>(
      c,
      `UPDATE stables SET gear_wear = jsonb_set(gear_wear, ARRAY[$2::text], to_jsonb(COALESCE((gear_wear->>$2)::int, 0) + 1))
        WHERE owner_id = $1 AND $2 = ANY(gear) RETURNING (gear_wear->>$2)::int AS used`,
      [ownerId, item],
    );
    if (!r || r.used < races) return false;
    await c.query(
      "UPDATE stables SET gear = array_remove(gear, $2), gear_wear = gear_wear - $2 WHERE owner_id = $1",
      [ownerId, item],
    );
    return true;
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

  /** Rename the stable for gems (sink RENAMES). Names are Latin-only and unique (case-insensitive). */
  async rename(ownerId: string, name: string): Promise<StableDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const s = await this.byOwner(c, ownerId, true);
      if (s.name === name) throw conflict("NAME_UNCHANGED", "That is already the stable's name");
      // Serialise renames to the same name so two owners cannot both take it.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('stable-name:' || lower($1)))", [name]);
      const taken = await row(c, "SELECT 1 FROM stables WHERE lower(name) = lower($1) AND id <> $2", [
        name,
        s.id,
      ]);
      if (taken) throw conflict("NAME_TAKEN", "Another stable already has this name");
      await this.ledger.debit(c, {
        userId: ownerId,
        currency: "GEMS",
        amount: this.config.get().economy.renameStableGems,
        sink: "RENAMES",
        key: `rename:stable:${s.id}:${now.getTime()}`,
        type: "RENAME",
        reason: `Stable renamed to ${name}`,
        metadata: { from: s.name, to: name },
      });
      await c.query("UPDATE stables SET name = $2, updated_at = $3 WHERE id = $1", [s.id, name, now]);
      await this.events.emit(c, {
        type: "stable_renamed",
        aggregateType: "stable",
        aggregateId: s.id,
        actorId: ownerId,
        payload: { from: s.name, to: name },
      });
    });
    return this.view(ownerId);
  }
}
