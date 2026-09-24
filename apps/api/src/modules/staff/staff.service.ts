import { Injectable } from "@nestjs/common";
import type {
  JockeyContractDto,
  JockeyDto,
  StaffContractDto,
  StaffDto,
  TrainerDto,
} from "@thoroughline/contracts";
import {
  generateJockey,
  generateTrainer,
  jockeySalary,
  maxJockeys,
  maxTrainers,
  Rng,
  trainerEffect,
  trainerSalary,
  type TrainingType,
} from "@thoroughline/engine";
import { randomUUID } from "node:crypto";
import { Clock } from "../../common/clock.js";
import { Db, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { StableService } from "../stable/stable.service.js";

const DAY = 86_400_000;

interface TrainerRow {
  id: string;
  name: string;
  skill: number;
  specialty: TrainingType | null;
  salary: number;
}

interface JockeyRow {
  id: string;
  name: string;
  skill: number;
  rides: number;
  wins: number;
}

interface ContractRow {
  id: string;
  trainer_id: string | null;
  jockey_id: string | null;
  owner_id: string;
  salary: number;
  periods: number;
  started_at: Date;
  paid_until: Date;
  ended_at: Date | null;
}

/**
 * Trainers: a shared pool, one stable per trainer at a time, weekly salary charged in advance
 * (sink `STAFF_SALARY`). A contract that cannot be paid at renewal ends; dismissal is immediate
 * and the current week is not refunded.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly stables: StableService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  private trainerDto(t: TrainerRow): TrainerDto {
    const cfg = this.config.get();
    const general = trainerEffect({ skill: t.skill, specialty: null }, "SPEED", cfg);
    const special = t.specialty ? trainerEffect(t, t.specialty, cfg) : general;
    return {
      id: t.id,
      name: t.name,
      skill: t.skill,
      specialty: t.specialty,
      salary: t.salary,
      effect: {
        gainPct: Math.round((general.gainMultiplier - 1) * 1000) / 10,
        specialtyGainPct: Math.round((special.gainMultiplier - 1) * 1000) / 10,
        injuryReductionPct: Math.round((1 - general.injuryMultiplier) * 1000) / 10,
      },
    };
  }

  /** Keep the hiring pool at its configured size (new trainers get the current salary scale). */
  async restock(): Promise<number> {
    const cfg = this.config.get();
    const free = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM trainers t
        WHERE NOT EXISTS (SELECT 1 FROM staff_contracts k WHERE k.trainer_id = t.id AND k.ended_at IS NULL)`,
    );
    const missing = cfg.staff.poolSize - free!.n;
    const rng = new Rng(randomUUID());
    for (let i = 0; i < missing; i++) {
      const t = generateTrainer(rng, cfg);
      await this.db.query("INSERT INTO trainers (name, skill, specialty, salary) VALUES ($1,$2,$3,$4)", [
        t.name,
        t.skill,
        t.specialty,
        trainerSalary(t.skill, cfg),
      ]);
    }
    return Math.max(0, missing);
  }

  async available(): Promise<TrainerDto[]> {
    const list = await this.db.query<TrainerRow>(
      `SELECT t.* FROM trainers t
        WHERE NOT EXISTS (SELECT 1 FROM staff_contracts k WHERE k.trainer_id = t.id AND k.ended_at IS NULL)
        ORDER BY t.skill DESC, t.id LIMIT 50`,
    );
    return list.map((t) => this.trainerDto(t));
  }

  async mine(userId: string): Promise<StaffDto> {
    const stable = await this.stables.byOwner(this.db.pool, userId);
    const list = await this.db.query<ContractRow & { t: TrainerRow }>(
      `SELECT k.*, row_to_json(t) AS t FROM staff_contracts k JOIN trainers t ON t.id = k.trainer_id
        WHERE k.owner_id = $1 AND k.ended_at IS NULL ORDER BY k.started_at`,
      [userId],
    );
    const contracts: StaffContractDto[] = list.map((k) => ({
      id: k.id,
      trainer: this.trainerDto(k.t),
      salary: k.salary,
      periods: k.periods,
      startedAt: k.started_at.toISOString(),
      paidUntil: k.paid_until.toISOString(),
    }));
    const jl = await this.db.query<ContractRow & { j: JockeyRow }>(
      `SELECT k.*, row_to_json(j) AS j FROM staff_contracts k JOIN jockeys j ON j.id = k.jockey_id
        WHERE k.owner_id = $1 AND k.ended_at IS NULL ORDER BY k.started_at`,
      [userId],
    );
    const jockeys: JockeyContractDto[] = jl.map((k) => ({
      id: k.id,
      jockey: this.jockeyDto(k.j),
      salary: k.salary,
      periods: k.periods,
      startedAt: k.started_at.toISOString(),
      paidUntil: k.paid_until.toISOString(),
    }));
    const cfg = this.config.get();
    return {
      contracts,
      maxTrainers: maxTrainers(stable.level, cfg),
      jockeys,
      maxJockeys: maxJockeys(stable.level, cfg),
      weeklyCost: [...contracts, ...jockeys].reduce((s, c) => s + c.salary, 0),
    };
  }

  private jockeyDto(j: JockeyRow): JockeyDto {
    const skill = Number(j.skill);
    return {
      id: j.id,
      name: j.name,
      skill,
      salary: jockeySalary(skill, this.config.get()),
      rides: j.rides,
      wins: j.wins,
    };
  }

  /** Keep the freelance jockey pool at its configured size. */
  async restockJockeys(): Promise<number> {
    const cfg = this.config.get();
    const free = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM jockeys j WHERE NOT j.is_house
          AND NOT EXISTS (SELECT 1 FROM staff_contracts k WHERE k.jockey_id = j.id AND k.ended_at IS NULL)`,
    );
    const rng = new Rng(randomUUID());
    let added = 0;
    for (let tries = 0; added < cfg.staff.jockeys.poolSize - free!.n && tries < 100; tries++) {
      const j = generateJockey(rng, cfg);
      const r = await this.db.query(
        "INSERT INTO jockeys (name, skill, is_house) VALUES ($1, $2, false) ON CONFLICT (name) DO NOTHING RETURNING id",
        [j.name, j.skill],
      );
      added += r.length;
    }
    return added;
  }

  async availableJockeys(): Promise<JockeyDto[]> {
    const list = await this.db.query<JockeyRow>(
      `SELECT j.id, j.name, j.skill, j.rides, j.wins FROM jockeys j WHERE NOT j.is_house
          AND NOT EXISTS (SELECT 1 FROM staff_contracts k WHERE k.jockey_id = j.id AND k.ended_at IS NULL)
        ORDER BY j.skill DESC, j.id LIMIT 50`,
    );
    return list.map((j) => this.jockeyDto(j));
  }

  async hireJockey(userId: string, jockeyId: string): Promise<StaffDto> {
    const now = this.clock.now();
    const cfg = this.config.get();
    await this.db.tx(async (c) => {
      const stable = await this.stables.byOwner(c, userId, true);
      const active = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM staff_contracts WHERE owner_id = $1 AND ended_at IS NULL AND jockey_id IS NOT NULL",
        [userId],
      );
      const limit = maxJockeys(stable.level, cfg);
      if (active!.n >= limit)
        throw conflict("STAFF_LIMIT", `Your stable can retain ${limit} jockey${limit === 1 ? "" : "s"}`);
      const j = await row<JockeyRow & { is_house: boolean }>(
        c,
        "SELECT id, name, skill, rides, wins, is_house FROM jockeys WHERE id = $1 FOR UPDATE",
        [jockeyId],
      );
      if (!j || j.is_house) throw notFound("Jockey");
      const taken = await row<{ id: string }>(
        c,
        "SELECT id FROM staff_contracts WHERE jockey_id = $1 AND ended_at IS NULL",
        [jockeyId],
      );
      if (taken) throw conflict("JOCKEY_TAKEN", "This jockey has just been retained elsewhere");
      const salary = jockeySalary(Number(j.skill), cfg);
      const k = await row<{ id: string }>(
        c,
        `INSERT INTO staff_contracts (jockey_id, owner_id, salary, started_at, paid_until)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [jockeyId, userId, salary, now, new Date(now.getTime() + cfg.staff.contractDays * DAY)],
      );
      await this.ledger.debit(c, {
        userId,
        currency: "CREDITS",
        amount: salary,
        sink: "STAFF_SALARY",
        key: `staff:${k!.id}:period:1`,
        type: "STAFF_SALARY",
        reason: `Retained ${j.name} (week 1)`,
        metadata: { contractId: k!.id, jockeyId },
      });
      await this.events.emit(c, {
        type: "jockey_retained",
        aggregateType: "jockey",
        aggregateId: jockeyId,
        actorId: userId,
        payload: { contractId: k!.id, salary },
      });
    });
    return this.mine(userId);
  }

  async hire(userId: string, trainerId: string): Promise<StaffDto> {
    const now = this.clock.now();
    const cfg = this.config.get();
    await this.db.tx(async (c) => {
      // Lock order: stable (serialises the owner's hires), then trainer.
      const stable = await this.stables.byOwner(c, userId, true);
      const active = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM staff_contracts WHERE owner_id = $1 AND ended_at IS NULL AND trainer_id IS NOT NULL",
        [userId],
      );
      const limit = maxTrainers(stable.level, cfg);
      if (active!.n >= limit)
        throw conflict("STAFF_LIMIT", `Your stable can employ ${limit} trainer${limit === 1 ? "" : "s"}`);
      const t = await row<TrainerRow>(c, "SELECT * FROM trainers WHERE id = $1 FOR UPDATE", [trainerId]);
      if (!t) throw notFound("Trainer");
      const taken = await row<{ id: string }>(
        c,
        "SELECT id FROM staff_contracts WHERE trainer_id = $1 AND ended_at IS NULL",
        [trainerId],
      );
      if (taken) throw conflict("TRAINER_TAKEN", "This trainer has just been hired elsewhere");
      const k = await row<{ id: string }>(
        c,
        `INSERT INTO staff_contracts (trainer_id, owner_id, salary, started_at, paid_until)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [trainerId, userId, t.salary, now, new Date(now.getTime() + cfg.staff.contractDays * DAY)],
      );
      await this.ledger.debit(c, {
        userId,
        currency: "CREDITS",
        amount: t.salary,
        sink: "STAFF_SALARY",
        key: `staff:${k!.id}:period:1`,
        type: "STAFF_SALARY",
        reason: `Hired ${t.name} (week 1)`,
        metadata: { contractId: k!.id, trainerId },
      });
      await this.events.emit(c, {
        type: "trainer_hired",
        aggregateType: "trainer",
        aggregateId: trainerId,
        actorId: userId,
        payload: { contractId: k!.id, salary: t.salary },
      });
    });
    return this.mine(userId);
  }

  async dismiss(userId: string, contractId: string): Promise<StaffDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const k = await row<ContractRow>(
        c,
        "SELECT * FROM staff_contracts WHERE id = $1 AND owner_id = $2 AND ended_at IS NULL FOR UPDATE",
        [contractId, userId],
      );
      if (!k) throw notFound("Contract");
      await c.query("UPDATE staff_contracts SET ended_at = $2, end_reason = 'DISMISSED' WHERE id = $1", [
        k.id,
        now,
      ]);
      await this.events.emit(c, {
        type: k.trainer_id ? "trainer_dismissed" : "jockey_dismissed",
        aggregateType: k.trainer_id ? "trainer" : "jockey",
        aggregateId: (k.trainer_id ?? k.jockey_id)!,
        actorId: userId,
        payload: { contractId },
      });
    });
    return this.mine(userId);
  }

  /** Charge the next week of every contract that has run out; end the ones the owner cannot pay. */
  async renewDue(): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM staff_contracts WHERE ended_at IS NULL AND paid_until <= $1 ORDER BY paid_until LIMIT 200",
      [this.clock.now()],
    );
    let n = 0;
    for (const d of due) if (await this.renew(d.id)) n++;
    return n;
  }

  async renew(contractId: string): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const k = await row<ContractRow & { name: string }>(
        c,
        `SELECT k.*, COALESCE(t.name, j.name) AS name FROM staff_contracts k
           LEFT JOIN trainers t ON t.id = k.trainer_id LEFT JOIN jockeys j ON j.id = k.jockey_id
          WHERE k.id = $1 FOR UPDATE OF k SKIP LOCKED`,
        [contractId],
      );
      if (!k || k.ended_at || k.paid_until > now) return false;
      const balance = (await this.ledger.balances(k.owner_id, c)).CREDITS;
      if (balance < k.salary) {
        await c.query("UPDATE staff_contracts SET ended_at = $2, end_reason = 'UNPAID' WHERE id = $1", [
          k.id,
          now,
        ]);
        await this.events.emit(c, {
          type: "trainer_left",
          aggregateType: k.trainer_id ? "trainer" : "jockey",
          aggregateId: (k.trainer_id ?? k.jockey_id)!,
          payload: { userId: k.owner_id, contractId: k.id, trainerName: k.name, salary: k.salary },
        });
        return true;
      }
      const period = k.periods + 1;
      await this.ledger.debit(c, {
        userId: k.owner_id,
        currency: "CREDITS",
        amount: k.salary,
        sink: "STAFF_SALARY",
        key: `staff:${k.id}:period:${period}`,
        type: "STAFF_SALARY",
        reason: `${k.name} (week ${period})`,
        metadata: { contractId: k.id },
      });
      // Keep the weekly rhythm; after a long outage restart from now instead of back-charging.
      const week = cfg.staff.contractDays * DAY;
      const next = k.paid_until.getTime() + week;
      const paidUntil = new Date(next > now.getTime() ? next : now.getTime() + week);
      await c.query("UPDATE staff_contracts SET periods = $2, paid_until = $3 WHERE id = $1", [
        k.id,
        period,
        paidUntil,
      ]);
      return true;
    });
  }
}
