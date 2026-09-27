import { Injectable } from "@nestjs/common";
import type { ExpertAdviceDto, RunStatsDto } from "@thoroughline/contracts";
import { advancedAdvice } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, row, rows } from "../../common/db.js";
import { forbidden } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { getHorse, type HorseRow } from "./horse.repo.js";

/**
 * Expert trainer's advice: bought once per horse (gems, sink ANALYTICS) and kept while the buyer
 * owns it. Built from owner-visible data (attributes, traits, aptitudes, ceilings only after
 * diagnostics) plus the horse's own race record — rules, not race simulation.
 */
@Injectable()
export class ExpertAdviceService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly clock: Clock,
  ) {}

  private async owned(userId: string, horseId: string): Promise<HorseRow> {
    const h = await getHorse(this.db.pool, horseId);
    if (h.owner_id !== userId) throw forbidden("You do not own this horse");
    return h;
  }

  private async stats(horseId: string, key: string): Promise<RunStatsDto[]> {
    const list = await rows<{ key: string; runs: number; wins: number; top3: number; avg: string }>(
      this.db.pool,
      `SELECT ${key} AS key, count(*)::int AS runs,
              count(*) FILTER (WHERE e.position = 1)::int AS wins,
              count(*) FILTER (WHERE e.position <= 3)::int AS top3,
              avg(e.position) AS avg
         FROM race_entries e JOIN races r ON r.id = e.race_id
        WHERE e.horse_id = $1 AND e.status = 'RAN' AND e.position IS NOT NULL
        GROUP BY 1 ORDER BY avg(e.position), runs DESC`,
      [horseId],
    );
    return list.map((x) => ({
      key: x.key,
      runs: x.runs,
      wins: x.wins,
      top3: x.top3,
      avgPosition: Math.round(Number(x.avg) * 10) / 10,
    }));
  }

  async get(userId: string, horseId: string): Promise<ExpertAdviceDto> {
    const h = await this.owned(userId, horseId);
    const unlocked = !!(await row(
      this.db.pool,
      "SELECT 1 FROM advice_unlocks WHERE user_id = $1 AND horse_id = $2",
      [userId, horseId],
    ));
    const cfg = this.config.get();
    const base = {
      horseId,
      locked: !unlocked,
      priceGems: cfg.economy.expertAdviceGems,
      diagnosed: !!h.diagnosed_at,
    };
    if (!unlocked) return { ...base, advice: null };
    const a = advancedAdvice(
      h.attributes,
      h.genome.traits,
      h.genome.aptitudes,
      h.diagnosed_at ? h.genome.ceilings : null,
      cfg,
    );
    const trip = `CASE WHEN r.distance <= 1400 THEN 'SPRINT' WHEN r.distance >= 2000 THEN 'STAYING' ELSE 'MILE' END`;
    return {
      ...base,
      advice: {
        ...a,
        history: {
          byStrategy: await this.stats(horseId, "e.strategy"),
          bySurface: await this.stats(horseId, "r.surface"),
          byTrip: await this.stats(horseId, trip),
        },
      },
    };
  }

  async unlock(userId: string, horseId: string): Promise<ExpertAdviceDto> {
    await this.owned(userId, horseId);
    await this.db.tx(async (c) => {
      const r = await c.query(
        "INSERT INTO advice_unlocks (user_id, horse_id, unlocked_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [userId, horseId, this.clock.now()],
      );
      if (r.rowCount === 0) return;
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: this.config.get().economy.expertAdviceGems,
        sink: "ANALYTICS",
        key: `advice:${userId}:${horseId}`,
        type: "EXPERT_ADVICE",
        reason: "Expert trainer's advice",
        metadata: { horseId },
      });
    });
    return this.get(userId, horseId);
  }
}
