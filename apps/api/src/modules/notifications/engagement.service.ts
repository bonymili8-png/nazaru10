import { Injectable } from "@nestjs/common";
import { Clock } from "../../common/clock.js";
import { Db, rows } from "../../common/db.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { dailyRaceBonusKey } from "../economy/daily-bonus.js";
import type { HorseRow } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Tunables (kept here: they shape messaging, not the game economy). */
export const NUDGE = {
  /** A player is nudged after this long away… */
  awayMs: 2 * DAY,
  /** …but not once they have been gone this long (they have moved on). */
  maxAwayMs: 14 * DAY,
  /** Minimum gap between two nudges, and the most nudges per absence. */
  gapMs: 3 * DAY,
  perAbsence: 3,
  /** Only send during this UTC window (daytime in Europe). */
  fromHourUtc: 7,
  toHourUtc: 18,
};

/** The morning stable report for active players (those away longer get comeback nudges). */
export const REPORT = {
  /** Sent from this UTC hour (10:00 in Kyiv, 08:00 in London)… */
  fromHourUtc: 7,
  /** …until this one; a player first seen after it gets tomorrow's. */
  toHourUtc: 11,
  /** Only for players seen within this long. */
  activeWithinMs: 2 * DAY,
  /** Horses named as ready; the rest are counted. */
  maxNamed: 3,
};

/**
 * Comeback nudges for players who stopped visiting: one friendly message with a button back into
 * the stable, rate-limited per absence. Delivery goes through the notifications outbox, which
 * honours the player's notification setting and language.
 */
@Injectable()
export class EngagementService {
  constructor(
    private readonly db: Db,
    private readonly events: EventsService,
    private readonly clock: Clock,
    private readonly horses: HorsesService,
    private readonly config: GameConfigService,
  ) {}

  async nudgeDue(limit = 200): Promise<number> {
    const now = this.clock.now();
    const h = now.getUTCHours();
    if (h < NUDGE.fromHourUtc || h >= NUDGE.toHourUtc) return 0;
    return this.db.tx(async (c) => {
      const due = await c.query<{ id: string; horse_name: string | null }>(
        `SELECT u.id,
                (SELECT h.name FROM horses h WHERE h.owner_id = u.id AND h.retired_at IS NULL
                  ORDER BY h.race_rating DESC, h.created_at LIMIT 1) AS horse_name
           FROM users u
          WHERE u.status = 'ACTIVE' AND u.telegram_id IS NOT NULL
            AND u.last_seen_at <= $1 AND u.last_seen_at > $2
            AND (u.last_nudge_at IS NULL OR u.last_nudge_at < u.last_seen_at
                 OR (u.last_nudge_at <= $3 AND u.nudges < $4))
          ORDER BY u.last_seen_at
          LIMIT $5
          FOR UPDATE OF u SKIP LOCKED`,
        [
          new Date(now.getTime() - NUDGE.awayMs),
          new Date(now.getTime() - NUDGE.maxAwayMs),
          new Date(now.getTime() - NUDGE.gapMs),
          NUDGE.perAbsence,
          limit,
        ],
      );
      for (const u of due.rows) {
        await c.query(
          `UPDATE users SET nudges = CASE WHEN last_nudge_at IS NULL OR last_nudge_at < last_seen_at THEN 1
                                          ELSE nudges + 1 END,
                            last_nudge_at = $2
            WHERE id = $1`,
          [u.id, now],
        );
        if (!u.horse_name) continue;
        await this.events.emit(c, {
          type: "comeback_nudge",
          aggregateType: "user",
          aggregateId: u.id,
          payload: { userId: u.id, horseName: u.horse_name },
        });
      }
      return due.rows.length;
    });
  }

  /**
   * Once a UTC morning, every active player (seen in the last two days, with the report and
   * notifications on) gets a short stable report: yesterday's runs, who is ready to race today,
   * and the first-race bonus waiting for them.
   */
  async reportDue(limit = 200): Promise<number> {
    const now = this.clock.now();
    const h = now.getUTCHours();
    if (h < REPORT.fromHourUtc || h >= REPORT.toHourUtc) return 0;
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const yesterday = new Date(today.getTime() - DAY);
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const due = await rows<{ id: string }>(
        c,
        `SELECT u.id FROM users u
          WHERE u.status = 'ACTIVE' AND u.telegram_id IS NOT NULL AND u.last_seen_at > $1
            AND (u.last_report_on IS NULL OR u.last_report_on < $2::date)
            AND (u.settings->>'notifications') IS DISTINCT FROM 'false'
            AND (u.settings->>'dailyReport') IS DISTINCT FROM 'false'
            AND EXISTS (SELECT 1 FROM horses h WHERE h.owner_id = u.id AND h.retired_at IS NULL)
          ORDER BY u.id LIMIT $3
          FOR UPDATE OF u SKIP LOCKED`,
        [new Date(now.getTime() - REPORT.activeWithinMs), today, limit],
      );
      for (const u of due) {
        await c.query("UPDATE users SET last_report_on = $2::date WHERE id = $1", [u.id, today]);
        const y = (
          await rows<{ runs: number; wins: number; places: number; prize: number }>(
            c,
            `SELECT count(*)::int AS runs, count(*) FILTER (WHERE e.position = 1)::int AS wins,
                    count(*) FILTER (WHERE e.position <= 3)::int AS places, COALESCE(sum(e.prize), 0)::int AS prize
               FROM race_entries e JOIN races r ON r.id = e.race_id
              WHERE e.owner_id = $1 AND e.status = 'RAN' AND r.completed_at >= $2 AND r.completed_at < $3`,
            [u.id, yesterday, today],
          )
        )[0]!;
        const mine = await rows<HorseRow>(
          c,
          "SELECT * FROM horses WHERE owner_id = $1 AND retired_at IS NULL ORDER BY race_rating DESC, created_at",
          [u.id],
        );
        const ready = mine.filter(
          (x) =>
            this.horses.effectiveStatus(x, now) === "IDLE" &&
            this.horses.condition(x, now).health >= cfg.condition.minHealthToRace,
        );
        // The first-race bonus only if they have not already raced since midnight UTC.
        const raced = await rows(c, "SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1", [
          dailyRaceBonusKey(u.id, now),
        ]);
        await this.events.emit(c, {
          type: "daily_report",
          aggregateType: "user",
          aggregateId: u.id,
          payload: {
            userId: u.id,
            ...y,
            ready: ready.slice(0, REPORT.maxNamed).map((x) => x.name),
            readyMore: Math.max(0, ready.length - REPORT.maxNamed),
            resting: mine.length - ready.length,
            bonus: raced.length ? 0 : cfg.economy.dailyRaceBonus,
          },
        });
      }
      return due.length;
    });
  }
}
