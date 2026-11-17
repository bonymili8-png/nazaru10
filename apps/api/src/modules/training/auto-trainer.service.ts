import { Inject, Injectable } from "@nestjs/common";
import type { AutoTrainerDto } from "@thoroughline/contracts";
import {
  autoSlotAt,
  autoTrainingPlan,
  type TrainingIntensity,
  type TrainingType,
} from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, rows } from "../../common/db.js";
import { AppError, badRequest, conflict } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { localTime, validTimezone } from "../../common/timezone.js";
import { LedgerService } from "../economy/ledger.service.js";
import { horsesByOwner } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { TrainingService } from "./training.service.js";

const DAY = 86_400_000;
/** The background round runs at most this often. */
const EVERY_MS = 60_000;

interface TrainerRow {
  user_id: string;
  paid_until: Date;
  paused: boolean;
  low_credits_on: string | null;
  expiry_notified: boolean;
}

/**
 * The auto-trainer, hired by the month for gems: twice a day, in the owner's own time zone, it
 * trains every free horse of the stable (not entered in a race or cup, not carrying a foal or
 * standing at stud, not listed for sale, not injured), paying the usual credits per session.
 * Morning (from 09:00): a fully rested horse gets a session on its most relevant attribute —
 * hard when it can take it — then the trainer rotates through the next ones. Afternoon (from
 * 16:00): a second, normal session on another attribute when it is safe. It never spends the
 * wallet below the credit floor (10 000), and tells the owner once a day when it stops there.
 * Convenience only: nothing an attentive owner cannot do by hand, never renewed automatically.
 */
@Injectable()
export class AutoTrainerService {
  private running = false;
  private lastRun = 0;

  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly training: TrainingService,
    private readonly events: EventsService,
    private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  private cfg() {
    return this.config.get().autoTrainer;
  }

  private async timezone(userId: string): Promise<string | null> {
    const r = await this.db.one<{ tz: string | null }>(
      "SELECT settings->>'timezone' AS tz FROM users WHERE id = $1",
      [userId],
    );
    return r?.tz ?? null;
  }

  async get(userId: string): Promise<AutoTrainerDto> {
    const a = this.cfg();
    const now = this.clock.now();
    const t = await this.db.one<TrainerRow>("SELECT * FROM auto_trainers WHERE user_id = $1", [userId]);
    const tz = await this.timezone(userId);
    const recent = await this.db.query<{
      horse_id: string;
      name: string;
      slot: "MORNING" | "AFTERNOON";
      type: TrainingType;
      intensity: TrainingIntensity;
      local_date: string;
      created_at: Date;
    }>(
      `SELECT r.horse_id, h.name, r.slot, s.type, s.intensity, to_char(r.local_date, 'YYYY-MM-DD') AS local_date, r.created_at
         FROM auto_training_runs r JOIN training_sessions s ON s.id = r.session_id JOIN horses h ON h.id = r.horse_id
        WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
      [userId],
    );
    return {
      active: !!t && t.paid_until > now,
      paidUntil: t?.paid_until.toISOString() ?? null,
      paused: t?.paused ?? false,
      priceGems: a.gems,
      days: a.days,
      maxDaysAhead: a.maxDaysAhead,
      minCredits: a.minCredits,
      hours: [a.morningHour, a.afternoonHour],
      timezone: tz,
      recent: recent.map((r) => ({
        horseId: r.horse_id,
        horseName: r.name,
        slot: r.slot,
        type: r.type,
        intensity: r.intensity,
        localDate: r.local_date,
        startedAt: r.created_at.toISOString(),
      })),
    };
  }

  /** Hire for a month, or add a month to the current period (up to `maxDaysAhead`). */
  async buy(userId: string, timezone: string | undefined): Promise<AutoTrainerDto> {
    const a = this.cfg();
    const now = this.clock.now();
    if (timezone !== undefined) {
      if (!validTimezone(timezone)) throw badRequest("BAD_TIMEZONE", "Unknown time zone");
      await this.db.query(
        "UPDATE users SET settings = settings || jsonb_build_object('timezone', $2::text) WHERE id = $1",
        [userId, timezone],
      );
    }
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO auto_trainers (user_id, paid_until, created_at, updated_at) VALUES ($1, 'epoch', $2, $2)
         ON CONFLICT DO NOTHING`,
        [userId, now],
      );
      const t = (
        await rows<TrainerRow>(c, "SELECT * FROM auto_trainers WHERE user_id = $1 FOR UPDATE", [userId])
      )[0]!;
      const from = t.paid_until > now ? t.paid_until : now;
      const until = new Date(from.getTime() + a.days * DAY);
      if (until.getTime() > now.getTime() + a.maxDaysAhead * DAY)
        throw conflict("TOO_FAR_AHEAD", `The trainer can be paid up to ${a.maxDaysAhead} days ahead`);
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: a.gems,
        sink: "AUTO_TRAINER",
        key: `auto-trainer:${userId}:${now.toISOString()}`,
        type: "AUTO_TRAINER",
        reason: `Auto-trainer, ${a.days} days`,
      });
      await c.query(
        `UPDATE auto_trainers SET paid_until = $2, paused = false, expiry_notified = false, updated_at = $3
          WHERE user_id = $1`,
        [userId, until, now],
      );
    });
    return this.get(userId);
  }

  async setPaused(userId: string, paused: boolean): Promise<AutoTrainerDto> {
    const r = await this.db.query(
      "UPDATE auto_trainers SET paused = $2, updated_at = $3 WHERE user_id = $1 AND paid_until > $3 RETURNING user_id",
      [userId, paused, this.clock.now()],
    );
    if (!r.length) throw conflict("NOT_HIRED", "The auto-trainer is not hired");
    return this.get(userId);
  }

  /** Job runner entry: returns at once and works in the background. */
  kick(): number {
    const now = Date.now();
    if (this.running || now - this.lastRun < EVERY_MS) return 0;
    this.lastRun = now;
    void this.runDue().catch((err) => this.logger.error({ err }, "auto-trainer round failed"));
    return 0;
  }

  /** One round over every hired trainer. Returns the sessions started. */
  async runDue(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = this.clock.now();
      await this.notifyExpired(now);
      const hired = await rows<TrainerRow & { tz: string | null }>(
        this.db.pool,
        `SELECT t.*, u.settings->>'timezone' AS tz FROM auto_trainers t JOIN users u ON u.id = t.user_id
          WHERE t.paid_until > $1 AND NOT t.paused AND u.status = 'ACTIVE'`,
        [now],
      );
      let started = 0;
      for (const t of hired) {
        try {
          started += await this.round(t, now);
        } catch (err) {
          this.logger.warn({ err, user: t.user_id }, "auto-trainer failed for a stable");
        }
      }
      return started;
    } finally {
      this.running = false;
    }
  }

  /** Train this stable's free horses for the run its local time is in. */
  private async round(t: TrainerRow & { tz: string | null }, now: Date): Promise<number> {
    const cfg = this.config.get();
    const local = localTime(now, t.tz);
    const slot = autoSlotAt(local.hour, cfg);
    if (!slot) return 0;
    await this.training.settleDueForOwner(t.user_id);
    const done = new Set(
      (
        await this.db.query<{ horse_id: string }>(
          "SELECT horse_id FROM auto_training_runs WHERE user_id = $1 AND local_date = $2 AND slot = $3",
          [t.user_id, local.date, slot],
        )
      ).map((r) => r.horse_id),
    );
    const studs = new Set(
      (
        await this.db.query<{ horse_id: string }>(
          "SELECT horse_id FROM studs WHERE owner_id = $1 AND active",
          [t.user_id],
        )
      ).map((r) => r.horse_id),
    );
    let started = 0;
    for (const h of await horsesByOwner(this.db.pool, t.user_id)) {
      // Free horses only: anything but IDLE is racing, entered, in foal, listed, injured or training.
      if (done.has(h.id) || studs.has(h.id) || h.retired_at || this.horses.effectiveStatus(h, now) !== "IDLE")
        continue;
      const recent = (
        await this.db.query<{ type: TrainingType }>(
          `SELECT s.type FROM auto_training_runs r JOIN training_sessions s ON s.id = r.session_id
            WHERE r.horse_id = $1 AND r.created_at > $2 ORDER BY r.created_at DESC`,
          [h.id, new Date(now.getTime() - cfg.autoTrainer.lookbackDays * DAY)],
        )
      ).map((r) => r.type);
      const plan = autoTrainingPlan(
        {
          slot,
          attributes: h.attributes,
          aptitudes: h.genome.aptitudes,
          condition: this.horses.condition(h, now),
          age: this.horses.age(h, now),
          recent,
        },
        cfg,
      );
      if ("skip" in plan) continue;
      // The credit floor: stop for the day when a session would take the wallet under it.
      const cost = Math.round(
        cfg.training.types[plan.type].cost * cfg.training.intensity[plan.intensity].cost,
      );
      const credits = (await this.ledger.balances(t.user_id)).CREDITS;
      if (credits - cost < cfg.autoTrainer.minCredits) {
        await this.lowCredits(t, local.date, credits);
        break;
      }
      try {
        const s = await this.training.start(t.user_id, h.id, plan.type, plan.intensity, { auto: true });
        await this.db.query(
          `INSERT INTO auto_training_runs (horse_id, local_date, slot, user_id, session_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [h.id, local.date, slot, t.user_id, s.id, now],
        );
        started++;
      } catch (err) {
        // The horse changed since the look (sent racing, sold, …): try again next round.
        if (!(err instanceof AppError)) throw err;
      }
    }
    return started;
  }

  /** Tell the owner once a (local) day that training stopped at the credit floor. */
  private async lowCredits(t: TrainerRow, localDate: string, credits: number): Promise<void> {
    if (t.low_credits_on === localDate) return;
    await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE auto_trainers SET low_credits_on = $2
          WHERE user_id = $1 AND low_credits_on IS DISTINCT FROM $2::date RETURNING user_id`,
        [t.user_id, localDate],
      );
      if (!r.rowCount) return;
      await this.events.emit(c, {
        type: "auto_trainer_low_credits",
        aggregateType: "user",
        aggregateId: t.user_id,
        payload: { userId: t.user_id, credits, minCredits: this.cfg().minCredits },
      });
    });
    t.low_credits_on = localDate;
  }

  /** Tell owners whose month has run out (once). */
  private async notifyExpired(now: Date): Promise<void> {
    await this.db.tx(async (c) => {
      const ended = await c.query<{ user_id: string }>(
        `UPDATE auto_trainers SET expiry_notified = true
          WHERE paid_until <= $1 AND NOT expiry_notified RETURNING user_id`,
        [now],
      );
      for (const r of ended.rows)
        await this.events.emit(c, {
          type: "auto_trainer_expired",
          aggregateType: "user",
          aggregateId: r.user_id,
          payload: { userId: r.user_id },
        });
    });
  }
}
