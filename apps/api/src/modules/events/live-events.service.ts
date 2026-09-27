import { Injectable } from "@nestjs/common";
import type { LiveEventDto } from "@thoroughline/contracts";
import { type RaceClass } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";

export interface LiveEventRow {
  id: string;
  kind: "PASS_XP_BOOST" | "PURSE_BOOST";
  title: string;
  multiplier: string;
  classes: RaceClass[] | null;
  starts_at: Date;
  ends_at: Date;
  cancelled_at: Date | null;
}

/** Hard limits so a console slip cannot flood the economy. */
export const EVENT_LIMITS = { maxDays: 7, xpMax: 3, purseMax: 1.5 } as const;

/**
 * Live-ops events: a temporary Racing Pass XP boost, or a purse boost on races (optionally only some
 * classes) that start inside the window. Purses of open races are boosted when the event is created
 * and restored if it is cancelled; races scheduled later pick the boost up at creation.
 */
@Injectable()
export class LiveEventsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  dto(e: LiveEventRow): LiveEventDto {
    return {
      id: e.id,
      kind: e.kind,
      title: e.title,
      multiplier: Number(e.multiplier),
      classes: e.classes,
      startsAt: e.starts_at.toISOString(),
      endsAt: e.ends_at.toISOString(),
      cancelled: e.cancelled_at !== null,
    };
  }

  /** Events running now or starting within a day (for the player banner). */
  async current(): Promise<LiveEventDto[]> {
    const now = this.clock.now();
    const list = await this.db.query<LiveEventRow>(
      `SELECT * FROM live_events WHERE cancelled_at IS NULL AND ends_at > $1 AND starts_at < $2
        ORDER BY starts_at`,
      [now, new Date(now.getTime() + 86_400_000)],
    );
    return list.map((e) => this.dto(e));
  }

  async all(): Promise<LiveEventDto[]> {
    return (
      await this.db.query<LiveEventRow>("SELECT * FROM live_events ORDER BY starts_at DESC LIMIT 50")
    ).map((e) => this.dto(e));
  }

  /** The largest XP multiplier active at `at` (1 when none). */
  async xpMultiplier(c: Queryable, at: Date): Promise<number> {
    const r = await row<{ m: string | null }>(
      c,
      `SELECT max(multiplier) AS m FROM live_events
        WHERE kind = 'PASS_XP_BOOST' AND cancelled_at IS NULL AND starts_at <= $1 AND ends_at > $1`,
      [at],
    );
    return r?.m ? Number(r.m) : 1;
  }

  /** The purse boost for a race of `cls` starting at `at`, if any. */
  async purseBoost(
    c: Queryable,
    cls: RaceClass,
    at: Date,
  ): Promise<{ id: string; multiplier: number } | null> {
    const r = await row<{ id: string; multiplier: string }>(
      c,
      `SELECT id, multiplier FROM live_events
        WHERE kind = 'PURSE_BOOST' AND cancelled_at IS NULL AND starts_at <= $1 AND ends_at > $1
          AND (classes IS NULL OR $2 = ANY(classes))
        ORDER BY multiplier DESC LIMIT 1`,
      [at, cls],
    );
    return r ? { id: r.id, multiplier: Number(r.multiplier) } : null;
  }

  async create(
    actorId: string,
    input: {
      kind: LiveEventRow["kind"];
      title: string;
      multiplier: number;
      classes: RaceClass[] | null;
      startsAt: Date;
      endsAt: Date;
    },
  ): Promise<LiveEventDto> {
    const now = this.clock.now();
    const max = input.kind === "PASS_XP_BOOST" ? EVENT_LIMITS.xpMax : EVENT_LIMITS.purseMax;
    if (input.multiplier <= 1 || input.multiplier > max)
      throw conflict("BAD_MULTIPLIER", `Multiplier must be above 1 and at most ${max}`);
    if (input.endsAt <= input.startsAt || input.endsAt <= now)
      throw conflict("BAD_WINDOW", "The event must end after it starts and in the future");
    if (input.endsAt.getTime() - input.startsAt.getTime() > EVENT_LIMITS.maxDays * 86_400_000)
      throw conflict("BAD_WINDOW", `Events last at most ${EVENT_LIMITS.maxDays} days`);
    return this.db.tx(async (c) => {
      const e = await row<LiveEventRow>(
        c,
        `INSERT INTO live_events (kind, title, multiplier, classes, starts_at, ends_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.kind, input.title, input.multiplier, input.classes, input.startsAt, input.endsAt, actorId],
      );
      if (input.kind === "PURSE_BOOST")
        // Boost already-scheduled open races in the window (not tournaments or special races).
        await c.query(
          `UPDATE races SET purse = round(purse * $2::numeric), event_id = $1
            WHERE status = 'OPEN' AND event_id IS NULL AND tournament_id IS NULL AND NOT is_special
              AND starts_at >= $3 AND starts_at < $4 AND ($5::text[] IS NULL OR class = ANY($5))`,
          [e!.id, input.multiplier, input.startsAt, input.endsAt, input.classes],
        );
      return this.dto(e!);
    });
  }

  async cancel(id: string): Promise<LiveEventDto> {
    return this.db.tx(async (c) => {
      const e = await row<LiveEventRow>(c, "SELECT * FROM live_events WHERE id = $1 FOR UPDATE", [id]);
      if (!e) throw notFound("Event");
      if (e.cancelled_at) throw conflict("ALREADY_CANCELLED", "This event is already cancelled");
      const done = await row<LiveEventRow>(
        c,
        "UPDATE live_events SET cancelled_at = $2 WHERE id = $1 RETURNING *",
        [id, this.clock.now()],
      );
      // Open races go back to their normal purse; locked or finished ones keep the promise.
      await c.query(
        "UPDATE races SET purse = round(purse / $2::numeric), event_id = NULL WHERE event_id = $1 AND status = 'OPEN'",
        [id, Number(e.multiplier)],
      );
      return this.dto(done!);
    });
  }
}
