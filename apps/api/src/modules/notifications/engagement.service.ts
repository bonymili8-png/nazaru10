import { Injectable } from "@nestjs/common";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { EventsService } from "../../common/events.js";

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
}
