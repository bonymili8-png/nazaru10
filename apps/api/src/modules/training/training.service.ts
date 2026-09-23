import { Injectable } from "@nestjs/common";
import type { TrainingSessionDto } from "@thoroughline/contracts";
import {
  abilityRating,
  assertTransition,
  bestTrainerFor,
  resolveTraining,
  Rng,
  trainingBlockReason,
  trainingCost,
  trainingDurationMinutes,
  type Condition,
  type TrainingIntensity,
  type TrainingOutcome,
  type TrainingType,
} from "@thoroughline/engine";
import { createHmac } from "node:crypto";
import { Inject } from "@nestjs/common";
import { ENV, type Env } from "../../config/env.js";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { conflict } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { getHorse, type HorseRow } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { QuestsService } from "../quests/quests.service.js";
import { StableService } from "../stable/stable.service.js";

interface SessionRow {
  id: string;
  horse_id: string;
  owner_id: string;
  type: TrainingType;
  intensity: TrainingIntensity;
  cost: number;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  start_state: {
    condition: Condition;
    age: number;
    sessionsLast24h: number;
    /** Supervising trainer at start (absent for sessions started before staff existed). */
    trainer?: { id: string; name: string; gainMultiplier: number; injuryMultiplier: number } | null;
    facilities?: { gainMultiplier: number; injuryMultiplier: number };
  };
  started_at: Date;
  completes_at: Date;
  completed_at: Date | null;
  result: TrainingOutcome | null;
}

const BLOCK_MESSAGES: Record<string, string> = {
  TOO_FATIGUED: "Too tired to train — rest or book a recovery session",
  HEALTH_TOO_LOW: "Health is too low to train safely",
  TOO_YOUNG: "Too young to train",
  TOO_OLD: "Retired from training",
};

@Injectable()
export class TrainingService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly events: EventsService,
    private readonly quests: QuestsService,
    private readonly stables: StableService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  toDto(s: SessionRow): TrainingSessionDto {
    return {
      id: s.id,
      horseId: s.horse_id,
      type: s.type,
      intensity: s.intensity,
      cost: s.cost,
      status: s.status,
      startedAt: s.started_at.toISOString(),
      completesAt: s.completes_at.toISOString(),
      result: s.result
        ? {
            gains: s.result.gains,
            injury: s.result.injury
              ? { severity: s.result.injury.severity, hours: s.result.injury.hours }
              : null,
          }
        : null,
      trainer: s.start_state.trainer
        ? {
            name: s.start_state.trainer.name,
            gainMultiplier: s.start_state.trainer.gainMultiplier,
            injuryMultiplier: s.start_state.trainer.injuryMultiplier,
          }
        : null,
    };
  }

  /** The owner's employed trainer who helps most with this session type. */
  private async trainerFor(c: Queryable, userId: string, type: TrainingType, now: Date) {
    const staff = await rows<{ id: string; name: string; skill: number; specialty: TrainingType | null }>(
      c,
      `SELECT t.id, t.name, t.skill, t.specialty FROM staff_contracts k JOIN trainers t ON t.id = k.trainer_id
        WHERE k.owner_id = $1 AND k.ended_at IS NULL AND k.paid_until > $2 ORDER BY t.id`,
      [userId, now],
    );
    const best = bestTrainerFor(staff, type, this.config.get());
    return best
      ? {
          id: best.trainer.id,
          name: best.trainer.name,
          gainMultiplier: best.effect.gainMultiplier,
          injuryMultiplier: best.effect.injuryMultiplier,
        }
      : null;
  }

  async start(
    userId: string,
    horseId: string,
    type: TrainingType,
    intensity: TrainingIntensity,
  ): Promise<TrainingSessionDto> {
    await this.settleDueForOwner(userId);
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      let h = await this.horses.lockOwned(c, horseId, userId);
      h = await this.horses.normalize(c, h, now);
      if (h.status !== "IDLE") throw conflict("HORSE_BUSY", `Horse is ${h.status.toLowerCase()}`);
      assertTransition(h.status, "TRAINING");
      const condition = { fatigue: h.fatigue, health: h.health, form: h.form };
      const age = this.horses.age(h, now);
      const block = trainingBlockReason(condition, age, type, cfg);
      if (block) throw conflict(block, BLOCK_MESSAGES[block] ?? block);

      const recent = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM training_sessions WHERE horse_id = $1 AND started_at > $2 AND status <> 'CANCELLED'",
        [horseId, new Date(now.getTime() - 86_400_000)],
      );
      const trainer = await this.trainerFor(c, userId, type, now);
      const facilities = await this.stables.trainingEffect(c, userId);
      const cost = trainingCost(type, intensity, cfg);
      const completesAt = new Date(now.getTime() + trainingDurationMinutes(type, intensity, cfg) * 60_000);
      const session = await row<SessionRow>(
        c,
        `INSERT INTO training_sessions (horse_id, owner_id, type, intensity, cost, start_state, started_at, completes_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          horseId,
          userId,
          type,
          intensity,
          cost,
          JSON.stringify({ condition, age, sessionsLast24h: recent!.n, trainer, facilities }),
          now,
          completesAt,
        ],
      );
      await this.ledger.debit(c, {
        userId,
        currency: "CREDITS",
        amount: cost,
        sink: "TRAINING",
        key: `training:${session!.id}`,
        type: "TRAINING",
        reason: `${type} (${intensity}) — ${h.name}`,
      });
      await c.query("UPDATE horses SET status = 'TRAINING', updated_at = $2 WHERE id = $1", [horseId, now]);
      await this.events.emit(c, {
        type: "training_started",
        aggregateType: "horse",
        aggregateId: horseId,
        actorId: userId,
        payload: { sessionId: session!.id, type, intensity, cost },
      });
      return this.toDto(session!);
    });
  }

  /** Settle one finished session (idempotent; safe under concurrency via row locks). */
  async settle(sessionId: string): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const s = await row<SessionRow>(
        c,
        "SELECT * FROM training_sessions WHERE id = $1 FOR UPDATE SKIP LOCKED",
        [sessionId],
      );
      if (!s || s.status !== "ACTIVE" || s.completes_at > now) return false;
      const h = await getHorse(c, s.horse_id, true);
      const seed = createHmac("sha256", this.env.RACE_SEED_SECRET).update(`training:${s.id}`).digest("hex");
      const out = resolveTraining(
        {
          type: s.type,
          intensity: s.intensity,
          attributes: h.attributes,
          genome: h.genome,
          condition: s.start_state.condition,
          age: s.start_state.age,
          sessionsLast24h: s.start_state.sessionsLast24h,
          trainerMultiplier: s.start_state.trainer?.gainMultiplier,
          trainerInjuryMultiplier: s.start_state.trainer?.injuryMultiplier,
          facilityMultiplier: s.start_state.facilities?.gainMultiplier,
          facilityInjuryMultiplier: s.start_state.facilities?.injuryMultiplier,
        },
        new Rng(seed),
        cfg,
      );
      const injuredUntil = out.injury
        ? new Date(s.completes_at.getTime() + out.injury.hours * 3_600_000)
        : null;
      await c.query(
        `UPDATE horses SET attributes = $2, ability_rating = $3, fatigue = $4, health = $5, condition_updated_at = $6,
                status = $7, injured_until = $8, updated_at = $9
          WHERE id = $1`,
        [
          h.id,
          JSON.stringify(out.attributes),
          abilityRating(out.attributes, h.genome.traits),
          out.fatigue,
          out.health,
          s.completes_at,
          out.injury ? "INJURED" : "IDLE",
          injuredUntil,
          now,
        ],
      );
      if (out.injury) {
        await c.query(
          `INSERT INTO injuries (horse_id, source, source_id, severity, heals_at, factors) VALUES ($1, 'TRAINING', $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [
            h.id,
            s.id,
            out.injury.severity,
            injuredUntil,
            JSON.stringify({ ...out.injury.factors, chance: out.injury.chance }),
          ],
        );
      }
      await c.query(
        "UPDATE training_sessions SET status = 'COMPLETED', completed_at = $2, result = $3 WHERE id = $1",
        [s.id, now, JSON.stringify(out)],
      );
      await this.events.emit(c, {
        type: "training_completed",
        aggregateType: "horse",
        aggregateId: h.id,
        actorId: s.owner_id,
        payload: {
          sessionId: s.id,
          userId: s.owner_id,
          horseName: h.name,
          gains: out.gains,
          injury: out.injury?.severity ?? null,
        },
      });
      await this.quests.complete(c, s.owner_id, "FIRST_TRAINING", now);
      return true;
    });
  }

  async settleDueForOwner(ownerId: string): Promise<void> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM training_sessions WHERE owner_id = $1 AND status = 'ACTIVE' AND completes_at <= $2",
      [ownerId, this.clock.now()],
    );
    for (const s of due) await this.settle(s.id);
  }

  /** Worker sweep: settle all finished sessions. */
  async settleAllDue(limit = 200): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM training_sessions WHERE status = 'ACTIVE' AND completes_at <= $1 ORDER BY completes_at LIMIT $2",
      [this.clock.now(), limit],
    );
    let n = 0;
    for (const s of due) if (await this.settle(s.id)) n++;
    return n;
  }

  async active(c: Queryable, horseIds: string[]): Promise<Map<string, TrainingSessionDto>> {
    if (horseIds.length === 0) return new Map();
    const list = await rows<SessionRow>(
      c,
      "SELECT * FROM training_sessions WHERE horse_id = ANY($1::uuid[]) AND status = 'ACTIVE'",
      [horseIds],
    );
    return new Map(list.map((s) => [s.horse_id, this.toDto(s)] as const));
  }

  async history(horseId: string, limit = 20): Promise<TrainingSessionDto[]> {
    return (
      await this.db.query<SessionRow>(
        "SELECT * FROM training_sessions WHERE horse_id = $1 ORDER BY started_at DESC LIMIT $2",
        [horseId, limit],
      )
    ).map((s) => this.toDto(s));
  }
}

export type { HorseRow };
