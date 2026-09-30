import { Injectable } from "@nestjs/common";
import type { GallopDto, GallopRequest, GallopsDto } from "@thoroughline/contracts";
import { bondNow, canRaceAtAge, runGallop, traitsWithBond } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, rows } from "../../common/db.js";
import { badRequest, conflict, forbidden } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { getHorse, type HorseRow } from "./horse.repo.js";
import { HorsesService } from "./horses.service.js";

interface GallopRow {
  id: string;
  at: Date;
  distance: number;
  surface: GallopDto["surface"];
  lead_class: GallopDto["leadClass"];
  fatigue: number;
  time: number;
  lead_time: number;
  margin: number;
}

/** Statuses a horse can go out on the gallops from (not away, hurt, racing or at stud). */
const CAN_WORK = new Set(["IDLE", "ENTERED", "LISTED"]);

/** Morning work on the clock (engine gallop/index.ts): information for the owner, never advice. */
@Injectable()
export class GallopService {
  constructor(
    private readonly db: Db,
    private readonly horses: HorsesService,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string, horseId: string): Promise<GallopsDto> {
    const h = await getHorse(this.db.pool, horseId);
    if (h.owner_id !== userId) throw forbidden("You do not own this horse");
    const now = this.clock.now();
    const history = await this.history(userId, horseId);
    // The cooldown follows the horse, whoever sent it out last.
    const last = (
      await rows<{ at: Date }>(this.db.pool, "SELECT max(at) AS at FROM gallops WHERE horse_id = $1", [
        horseId,
      ])
    )[0];
    const { block, availableAt } = this.availability(h, last?.at ?? null, now);
    const cfg = this.config.get().gallop;
    return {
      ready: block === null,
      block,
      availableAt: availableAt?.toISOString() ?? null,
      distances: cfg.distances,
      fatigueCost: cfg.fatigue,
      history: history.map((r) => this.dto(r)),
    };
  }

  async work(userId: string, horseId: string, req: GallopRequest): Promise<GallopDto> {
    const cfg = this.config.get();
    if (!cfg.gallop.distances.includes(req.distance))
      throw badRequest("BAD_DISTANCE", `Distances: ${cfg.gallop.distances.join(", ")} m`);
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const h = await this.horses.normalize(c, await this.horses.lockOwned(c, horseId, userId), now);
      const last = (
        await rows<{ at: Date }>(c, "SELECT at FROM gallops WHERE horse_id = $1 ORDER BY at DESC LIMIT 1", [
          h.id,
        ])
      )[0];
      const { block } = this.availability(h, last?.at ?? null, now);
      if (block) throw conflict(block, BLOCK_MESSAGES[block]!);
      const cond = this.horses.condition(h, now);
      const res = runGallop(
        {
          id: h.id,
          name: h.name,
          attributes: h.attributes,
          traits: traitsWithBond(h.genome.traits, bondNow(h.bond, h.bond_at, now, cfg), cfg),
          aptitudes: h.genome.aptitudes,
          raceIntelligence: h.genome.hidden.raceIntelligence,
          condition: cond,
          strategy: "MID_PACK",
          jockey: { id: "work-rider", name: "Work rider", skill: cfg.gallop.riderSkill },
        },
        req.leadClass,
        req.surface,
        req.distance,
        `gallop:${h.id}:${now.toISOString()}`,
        cfg,
      );
      await c.query("UPDATE horses SET fatigue = LEAST(100, fatigue + $3), updated_at = $2 WHERE id = $1", [
        h.id,
        now,
        cfg.gallop.fatigue,
      ]);
      const row = (
        await rows<GallopRow>(
          c,
          `INSERT INTO gallops (horse_id, owner_id, at, distance, surface, lead_class, fatigue, time, lead_time, margin)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [
            h.id,
            userId,
            now,
            req.distance,
            req.surface,
            req.leadClass,
            cond.fatigue,
            res.time,
            res.leadTime,
            res.margin,
          ],
        )
      )[0]!;
      return this.dto(row);
    });
  }

  private availability(h: HorseRow, lastAt: Date | null, now: Date) {
    const cfg = this.config.get();
    const none = { availableAt: null };
    if (!CAN_WORK.has(this.horses.effectiveStatus(h, now))) return { block: "BUSY", ...none };
    if (!canRaceAtAge(this.horses.age(h, now), cfg)) return { block: "TOO_YOUNG", ...none };
    const cond = this.horses.condition(h, now);
    if (cond.health < cfg.condition.minHealthToRace) return { block: "NOT_FIT", ...none };
    if (cond.fatigue > cfg.gallop.maxFatigue) return { block: "TOO_TIRED", ...none };
    if (lastAt) {
      const at = new Date(lastAt.getTime() + cfg.gallop.cooldownHours * 3_600_000);
      if (at > now) return { block: "COOLDOWN", availableAt: at };
    }
    return { block: null, ...none };
  }

  private history(userId: string, horseId: string) {
    return rows<GallopRow>(
      this.db.pool,
      "SELECT * FROM gallops WHERE horse_id = $1 AND owner_id = $2 ORDER BY at DESC LIMIT 10",
      [horseId, userId],
    );
  }

  private dto(r: GallopRow): GallopDto {
    return {
      id: r.id,
      at: r.at.toISOString(),
      distance: r.distance,
      surface: r.surface,
      leadClass: r.lead_class,
      fatigue: Math.round(r.fatigue),
      time: Math.round(r.time * 10) / 10,
      leadTime: Math.round(r.lead_time * 10) / 10,
      margin: r.margin,
    };
  }
}

const BLOCK_MESSAGES: Record<string, string> = {
  BUSY: "The horse cannot go out on the gallops right now",
  TOO_YOUNG: "Too young for fast work",
  NOT_FIT: "Not fit enough for fast work",
  TOO_TIRED: "Too tired for fast work — let it recover first",
  COOLDOWN: "It has already worked recently",
};
