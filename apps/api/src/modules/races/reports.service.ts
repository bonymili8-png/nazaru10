import { Injectable } from "@nestjs/common";
import type { RaceReportDto } from "@thoroughline/contracts";
import { raceReport } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { memberSql } from "../../common/membership.js";
import { LedgerService } from "../economy/ledger.service.js";
import type { EntryRow, RaceRow, ResultRow } from "./race.types.js";

type Run = EntryRow & { horse_name: string };

/**
 * Post-race reports: sectionals, positions, energy and trouble for one of the viewer's own runs,
 * once the result is public. Gems (sink `ANALYTICS`), free for Owners' Circle members. They explain
 * a finished race and never predict a future one.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly clock: Clock,
  ) {}

  /** The viewer's run in a race whose result is public (else 404 / 409). */
  private async run(c: Queryable, userId: string, raceId: string, horseId: string): Promise<Run> {
    const race = await row<RaceRow>(c, "SELECT * FROM races WHERE id = $1", [raceId]);
    if (!race) throw notFound("Race");
    const e = await row<Run>(
      c,
      `SELECT e.*, h.name AS horse_name FROM race_entries e JOIN horses h ON h.id = e.horse_id
        WHERE e.race_id = $1 AND e.horse_id = $2 AND e.owner_id = $3 AND e.status IN ('ENTERED','RAN')`,
      [raceId, horseId, userId],
    );
    if (!e) throw notFound("Run");
    if (race.status !== "COMPLETED" || !race.results_at || race.results_at > this.clock.now())
      throw conflict("RESULTS_PENDING", "The report is ready once the result is official");
    return e;
  }

  private async member(c: Queryable, userId: string): Promise<boolean> {
    const m = await row<{ member: boolean }>(c, `SELECT ${memberSql("$1", "$2")} AS member`, [
      userId,
      this.clock.now(),
    ]);
    return !!m?.member;
  }

  async get(userId: string, raceId: string, horseId: string): Promise<RaceReportDto> {
    const c = this.db.pool;
    const e = await this.run(c, userId, raceId, horseId);
    const member = await this.member(c, userId);
    const unlocked =
      member ||
      !!(await row(c, "SELECT 1 FROM race_reports WHERE user_id = $1 AND race_id = $2 AND horse_id = $3", [
        userId,
        raceId,
        horseId,
      ]));
    const base = {
      horseId,
      horseName: e.snapshot?.name ?? e.horse_name,
      locked: !unlocked,
      priceGems: this.config.get().economy.raceReportGems,
      member,
    };
    if (!unlocked) return { ...base, report: null };
    const res = await row<ResultRow & { distance: number }>(
      c,
      "SELECT rr.*, r.distance FROM race_results rr JOIN races r ON r.id = rr.race_id WHERE rr.race_id = $1",
      [raceId],
    );
    if (!res || !e.snapshot || e.position === null) throw notFound("Result");
    const report = raceReport(res.frames, res.events, horseId, {
      distance: res.distance,
      fatigueAtStart: e.snapshot.condition.fatigue,
      optimalDistance: e.snapshot.aptitudes.optimalDistance,
      position: e.position,
    });
    return { ...base, report: { ...report, strategy: e.strategy, gear: e.gear } };
  }

  async unlock(userId: string, raceId: string, horseId: string): Promise<RaceReportDto> {
    await this.db.tx(async (c) => {
      await this.run(c, userId, raceId, horseId);
      if (await this.member(c, userId)) return;
      const r = await c.query(
        "INSERT INTO race_reports (user_id, race_id, horse_id, unlocked_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [userId, raceId, horseId, this.clock.now()],
      );
      if (r.rowCount === 0) return;
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: this.config.get().economy.raceReportGems,
        sink: "ANALYTICS",
        key: `report:${userId}:${raceId}:${horseId}`,
        type: "RACE_REPORT",
        reason: "Race report",
        metadata: { raceId, horseId },
      });
    });
    return this.get(userId, raceId, horseId);
  }
}
