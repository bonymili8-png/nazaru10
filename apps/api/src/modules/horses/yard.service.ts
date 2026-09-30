import { Injectable } from "@nestjs/common";
import type {
  YardChoice,
  YardDto,
  YardEventDto,
  YardEventKind,
  YardOutcomeDto,
} from "@thoroughline/contracts";
import {
  bondNow,
  clamp,
  Rng,
  yardActCost,
  yardEventFor,
  yardOutcome,
  yardWindow,
} from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, rows } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { getHorse, horsesByOwner } from "./horse.repo.js";
import { HorsesService } from "./horses.service.js";

interface YardRow {
  id: string;
  user_id: string;
  horse_id: string;
  kind: YardEventKind;
  happened_at: Date;
  expires_at: Date;
  choice: YardChoice | null;
  answered: boolean;
  resolved_at: Date | null;
  outcome: YardOutcomeDto | null;
  horse_name: string;
}

/**
 * Yard events (engine yard/index.ts). Created lazily when the owner looks (no cron): the
 * current and previous windows are checked against the seeded roll, so creation is idempotent
 * (one row per owner per window). An event nobody answers settles as WAIT once it expires.
 */
@Injectable()
export class YardService {
  constructor(
    private readonly db: Db,
    private readonly horses: HorsesService,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string): Promise<YardDto> {
    await this.sync(userId);
    const now = this.clock.now();
    const list = await rows<YardRow>(
      this.db.pool,
      `SELECT y.*, h.name AS horse_name FROM yard_events y JOIN horses h ON h.id = y.horse_id
        WHERE y.user_id = $1 AND (y.resolved_at IS NULL OR y.resolved_at > $2)
        ORDER BY (y.resolved_at IS NULL) DESC, y.happened_at DESC LIMIT 10`,
      [userId, new Date(now.getTime() - 86_400_000)],
    );
    return { events: list.map((r) => this.dto(r)) };
  }

  /** Answer an open event. */
  async resolve(userId: string, eventId: string, choice: YardChoice): Promise<YardEventDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const ev = (
        await rows<YardRow>(c, "SELECT * FROM yard_events WHERE id = $1 AND user_id = $2 FOR UPDATE", [
          eventId,
          userId,
        ])
      )[0];
      if (!ev) throw notFound("Yard event");
      if (ev.resolved_at) throw conflict("YARD_SETTLED", "This has already been dealt with");
      if (ev.expires_at <= now) throw conflict("YARD_SETTLED", "Too late: the yard dealt with it");
      await this.apply(c, ev, choice, true, now);
    });
    const r = await rows<YardRow>(
      this.db.pool,
      "SELECT y.*, h.name AS horse_name FROM yard_events y JOIN horses h ON h.id = y.horse_id WHERE y.id = $1",
      [eventId],
    );
    return this.dto(r[0]!);
  }

  /** Create due events for the current and previous windows; settle expired ones. */
  async sync(userId: string): Promise<void> {
    const cfg = this.config.get();
    const now = this.clock.now();
    const user = (
      await rows<{ created_at: Date }>(this.db.pool, "SELECT created_at FROM users WHERE id = $1", [userId])
    )[0];
    if (!user) return;
    const settleFrom = user.created_at.getTime() + cfg.yard.minAccountAgeHours * 3_600_000;
    const w = yardWindow(now, cfg);
    const owned = await horsesByOwner(this.db.pool, userId);
    const list = owned.map((h) => ({ id: h.id, lastRaceAt: h.last_race_at }));
    for (const window of [w - 1, w]) {
      const ev = yardEventFor(userId, window, list, cfg);
      if (!ev || ev.at > now || ev.at.getTime() < settleFrom) continue;
      await this.db.query(
        `INSERT INTO yard_events (user_id, horse_id, kind, window_no, happened_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, window_no) DO NOTHING`,
        [
          userId,
          ev.horseId,
          ev.kind,
          window,
          ev.at,
          new Date(ev.at.getTime() + cfg.yard.expiresHours * 3_600_000),
        ],
      );
    }
    const expired = await rows<{ id: string }>(
      this.db.pool,
      "SELECT id FROM yard_events WHERE user_id = $1 AND resolved_at IS NULL AND expires_at <= $2",
      [userId, now],
    );
    for (const { id } of expired)
      await this.db.tx(async (c) => {
        const ev = (
          await rows<YardRow>(
            c,
            "SELECT * FROM yard_events WHERE id = $1 AND resolved_at IS NULL FOR UPDATE",
            [id],
          )
        )[0];
        if (ev) await this.apply(c, ev, "WAIT", false, now);
      });
  }

  /** Apply a choice to the horse (and wallet) and settle the event. */
  private async apply(c: Queryable, ev: YardRow, choice: YardChoice, answered: boolean, now: Date) {
    const cfg = this.config.get();
    const e = yardOutcome(ev.kind, choice, new Rng(`yard-outcome:${ev.id}`), cfg);
    let h = await getHorse(c, ev.horse_id, true);
    let outcome: YardOutcomeDto = e;
    if (h.owner_id !== ev.user_id || h.retired_at) {
      // Sold or retired before it settled: it is no longer this owner's worry.
      if (answered) throw conflict("HORSE_GONE", "This horse is no longer in your yard");
      outcome = { ...e, credits: 0, void: true };
    } else {
      h = await this.horses.normalize(c, h, now);
      if (e.credits > 0)
        await this.ledger.debit(c, {
          userId: ev.user_id,
          currency: "CREDITS",
          amount: e.credits,
          sink: "VET",
          key: `yard:${ev.id}`,
          type: "YARD_CALL_OUT",
          reason: `Yard call-out: ${ev.kind}`,
        });
      const bond = clamp(bondNow(h.bond, h.bond_at, now, cfg) + e.bond, 0, cfg.care.bondMax);
      await c.query(
        `UPDATE horses SET
            fatigue = LEAST(100, GREATEST(0, fatigue + $3)),
            health = LEAST(100, GREATEST(0, health + $4)),
            bond = $5, bond_at = $2,
            shoe_starts = CASE WHEN $6 THEN 0 WHEN $7 THEN GREATEST(shoe_starts, $8) ELSE shoe_starts END,
            care_last = CASE WHEN $7 THEN care_last || jsonb_build_object('FARRIER', $2::timestamptz)
                             ELSE care_last END,
            next_start_injury = next_start_injury * $9,
            updated_at = $2
          WHERE id = $1`,
        [
          h.id,
          now,
          e.fatigue,
          e.health,
          bond,
          e.freshShoes,
          e.shoesWorn,
          cfg.care.shoeStarts,
          e.injuryFactor,
        ],
      );
    }
    await c.query(
      "UPDATE yard_events SET choice = $2, answered = $3, resolved_at = $4, outcome = $5 WHERE id = $1",
      [ev.id, choice, answered, now, JSON.stringify(outcome)],
    );
  }

  private dto(r: YardRow): YardEventDto {
    return {
      id: r.id,
      horseId: r.horse_id,
      horseName: r.horse_name,
      kind: r.kind,
      happenedAt: r.happened_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      actCost: yardActCost(r.kind, this.config.get()),
      choice: r.choice,
      answered: r.answered,
      outcome: r.outcome,
    };
  }
}
