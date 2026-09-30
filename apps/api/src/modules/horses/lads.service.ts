import { Injectable } from "@nestjs/common";
import type { StableLadsDto } from "@thoroughline/contracts";
import { ladJobs, ladsCover, ladsNeeded } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, rows } from "../../common/db.js";
import { AppError, badRequest, conflict } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { CareService } from "./care.service.js";
import { horsesByOwner } from "./horse.repo.js";
import { HorsesService } from "./horses.service.js";

const WEEK_MS = 7 * 86_400_000;

interface LadsRow {
  user_id: string;
  lads: number;
  paid_until: Date;
  last_round_at: Date | null;
  last_work_at: Date | null;
  last_work_jobs: number;
}

/**
 * Stable lads, hired by the week for gems, do the yard round for the owner: every free care job
 * as it comes due (engine care/index.ts `ladJobs`). Convenience only — the owner can do the same
 * jobs by hand for nothing. One lad looks after `horsesPerLad` horses; two, the whole yard.
 * Paid in advance, never renewed automatically (gems are only spent on the owner's say-so).
 */
@Injectable()
export class LadsService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
    private readonly care: CareService,
    private readonly horses: HorsesService,
  ) {}

  async get(userId: string): Promise<StableLadsDto> {
    const row = (
      await rows<LadsRow>(this.db.pool, "SELECT * FROM stable_lads WHERE user_id = $1", [userId])
    )[0];
    const n = (await horsesByOwner(this.db.pool, userId)).length;
    return this.dto(row ?? null, n, this.clock.now());
  }

  /** Hire `lads` for a week, add a week for the same team, or add a lad for the rest of the period. */
  async hire(userId: string, lads: number): Promise<StableLadsDto> {
    const cfg = this.config.get().care.lads;
    if (lads < 1 || lads > cfg.maxLads) throw badRequest("BAD_LADS", `Hire 1 to ${cfg.maxLads} lads`);
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      await c.query(
        "INSERT INTO stable_lads (user_id, lads, paid_until) VALUES ($1, 1, 'epoch') ON CONFLICT DO NOTHING",
        [userId],
      );
      const row = (
        await rows<LadsRow>(c, "SELECT * FROM stable_lads WHERE user_id = $1 FOR UPDATE", [userId])
      )[0]!;
      const active = row.paid_until > now;
      let gems: number;
      let until = row.paid_until;
      if (!active) {
        gems = lads * cfg.gemsPerLadWeek;
        until = new Date(now.getTime() + WEEK_MS);
      } else if (lads === row.lads) {
        until = new Date(row.paid_until.getTime() + WEEK_MS);
        if (until.getTime() > now.getTime() + cfg.maxWeeksAhead * WEEK_MS)
          throw conflict("TOO_FAR_AHEAD", `Lads can be paid up to ${cfg.maxWeeksAhead} weeks ahead`);
        gems = lads * cfg.gemsPerLadWeek;
      } else if (lads > row.lads) {
        // The extra lad joins for the rest of the paid period, at the pro-rata price.
        const left = (row.paid_until.getTime() - now.getTime()) / WEEK_MS;
        gems = Math.ceil((lads - row.lads) * cfg.gemsPerLadWeek * left);
      } else {
        throw conflict("LADS_UNDER_CONTRACT", "The lads stay until their paid week ends");
      }
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: gems,
        sink: "STABLE_LADS",
        key: `lads:${userId}:${now.toISOString()}`,
        type: "STABLE_LADS",
        reason: `${lads} stable lad(s)`,
      });
      await c.query(
        `UPDATE stable_lads SET lads = $2, paid_until = $3,
            last_round_at = CASE WHEN $4 THEN last_round_at ELSE NULL END
          WHERE user_id = $1`,
        [userId, lads, until, active],
      );
    });
    // They start straight away.
    await this.round(userId, lads);
    return this.get(userId);
  }

  /** Job: send every paid team that is due on its round. Returns the jobs done. */
  async runDue(): Promise<number> {
    const now = this.clock.now();
    const every = this.config.get().care.lads.roundEveryMinutes * 60_000;
    const due = await rows<{ user_id: string; lads: number }>(
      this.db.pool,
      `UPDATE stable_lads SET last_round_at = $1
        WHERE user_id IN (
          SELECT user_id FROM stable_lads
           WHERE paid_until > $1 AND (last_round_at IS NULL OR last_round_at <= $2)
           ORDER BY last_round_at NULLS FIRST LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING user_id, lads`,
      [now, new Date(now.getTime() - every)],
    );
    let jobs = 0;
    for (const d of due) jobs += await this.round(d.user_id, d.lads);
    return jobs;
  }

  /** One round of the yard: each looked-after horse gets every care job that is due. */
  private async round(userId: string, lads: number): Promise<number> {
    const cfg = this.config.get();
    const now = this.clock.now();
    const covered = (await horsesByOwner(this.db.pool, userId)).slice(0, ladsCover(lads, cfg));
    let jobs = 0;
    for (const h of covered) {
      const ready = this.horses
        .careDto(h, now)
        .actions.filter((a) => a.ready)
        .map((a) => a.action);
      for (const action of ladJobs(ready, this.horses.careState(h), cfg)) {
        try {
          await this.care.perform(userId, h.id, action);
          jobs++;
        } catch (err) {
          // The horse changed since the look (sold, sent training): leave it for the next round.
          if (!(err instanceof AppError)) throw err;
        }
      }
    }
    await this.db.query(
      "UPDATE stable_lads SET last_round_at = $2, last_work_at = CASE WHEN $3 > 0 THEN $2 ELSE last_work_at END, last_work_jobs = CASE WHEN $3 > 0 THEN $3 ELSE last_work_jobs END WHERE user_id = $1",
      [userId, now, jobs],
    );
    return jobs;
  }

  private dto(row: LadsRow | null, horses: number, now: Date): StableLadsDto {
    const cfg = this.config.get();
    const l = cfg.care.lads;
    const active = row !== null && row.paid_until > now;
    const lads = active ? row.lads : 0;
    const left = active ? (row.paid_until.getTime() - now.getTime()) / WEEK_MS : 0;
    return {
      lads,
      paidUntil: active ? row.paid_until.toISOString() : null,
      horses,
      needed: ladsNeeded(horses, cfg),
      covered: Math.min(horses, lads ? ladsCover(lads, cfg) : 0),
      gemsPerLadWeek: l.gemsPerLadWeek,
      horsesPerLad: l.horsesPerLad,
      maxLads: l.maxLads,
      upgradeGems:
        active && lads < l.maxLads ? Math.ceil((l.maxLads - lads) * l.gemsPerLadWeek * left) : null,
      canExtend: active
        ? row.paid_until.getTime() + WEEK_MS <= now.getTime() + l.maxWeeksAhead * WEEK_MS
        : true,
      lastWorkAt: row?.last_work_at?.toISOString() ?? null,
      lastWorkJobs: row?.last_work_jobs ?? 0,
    };
  }
}
