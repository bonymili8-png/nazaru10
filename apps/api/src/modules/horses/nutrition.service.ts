import { Injectable } from "@nestjs/common";
import { type FeedPlan, feedCost } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import type { HorseRow } from "./horse.repo.js";
import { HorsesService } from "./horses.service.js";

const DAY = 86_400_000;

/**
 * Feed plans: per horse, weekly, charged in advance (sink `FEED`). They only change recovery
 * between sessions (fatigue, health, form), never attributes or race-day strength. Changing plan
 * folds the horse's condition first, so the new rate applies from that moment on.
 */
@Injectable()
export class NutritionService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  /**
   * Choose a plan. STANDARD stops renewal (the paid week runs out); the current paid plan resumes
   * renewal; another paid plan starts a new week now, charged in full (the old week is not refunded).
   */
  async set(userId: string, horseId: string, plan: FeedPlan): Promise<HorseRow> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const h = await this.horses.lockOwned(c, horseId, userId);
      if (plan === h.feed_plan || (plan === "STANDARD" && h.feed_plan !== "STANDARD")) {
        if (h.feed_plan === "STANDARD") return h;
        return (await row<HorseRow>(
          c,
          "UPDATE horses SET feed_renews = $2, updated_at = $3 WHERE id = $1 RETURNING *",
          [h.id, plan !== "STANDARD", now],
        ))!;
      }
      const folded = await this.horses.normalize(c, h, now);
      const cost = feedCost(plan, cfg);
      await this.ledger.debit(c, {
        userId,
        currency: "CREDITS",
        amount: cost,
        sink: "FEED",
        // One charge per plan start (the row lock serialises concurrent requests).
        key: `feed:${h.id}:${plan}:${now.getTime()}`,
        type: "FEED",
        reason: `${h.name}: feed plan (week 1)`,
        metadata: { horseId: h.id, plan },
      });
      const next = await row<HorseRow>(
        c,
        `UPDATE horses SET feed_plan = $2, feed_paid_until = $3, feed_renews = true, feed_periods = 1, updated_at = $4
          WHERE id = $1 RETURNING *`,
        [h.id, plan, new Date(now.getTime() + cfg.nutrition.periodDays * DAY), now],
      );
      await this.events.emit(c, {
        type: "feed_started",
        aggregateType: "horse",
        aggregateId: h.id,
        actorId: userId,
        payload: { plan, cost, previous: folded.feed_plan },
      });
      return next!;
    });
  }

  /** Charge the next week of every due paid plan; lapse the ones not renewing or not affordable. */
  async renewDue(): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM horses WHERE feed_plan <> 'STANDARD' AND feed_paid_until <= $1
        ORDER BY feed_paid_until LIMIT 200`,
      [this.clock.now()],
    );
    let n = 0;
    for (const d of due) if (await this.renew(d.id)) n++;
    return n;
  }

  async renew(horseId: string): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const h = await row<HorseRow>(c, "SELECT * FROM horses WHERE id = $1 FOR UPDATE SKIP LOCKED", [
        horseId,
      ]);
      if (!h || h.feed_plan === "STANDARD" || !h.feed_paid_until || h.feed_paid_until > now) return false;
      const cost = feedCost(h.feed_plan, cfg);
      const payable =
        h.feed_renews &&
        !h.retired_at &&
        !h.is_house &&
        h.owner_id !== null &&
        (await this.ledger.balances(h.owner_id, c)).CREDITS >= cost;
      if (!payable) {
        await this.lapse(c, h, now);
        return true;
      }
      const period = h.feed_periods + 1;
      await this.ledger.debit(c, {
        userId: h.owner_id!,
        currency: "CREDITS",
        amount: cost,
        sink: "FEED",
        key: `feed:${h.id}:${h.feed_paid_until.getTime()}:period:${period}`,
        type: "FEED",
        reason: `${h.name}: feed plan (week ${period})`,
        metadata: { horseId: h.id, plan: h.feed_plan },
      });
      // Keep the weekly rhythm; after a long outage restart from now instead of back-charging.
      const week = cfg.nutrition.periodDays * DAY;
      const next = h.feed_paid_until.getTime() + week;
      await c.query("UPDATE horses SET feed_periods = $2, feed_paid_until = $3 WHERE id = $1", [
        h.id,
        period,
        new Date(next > now.getTime() ? next : now.getTime() + week),
      ]);
      return true;
    });
  }

  /** Back to the free plan: fold the condition at the old rate first. */
  private async lapse(c: Queryable, h: HorseRow, now: Date): Promise<void> {
    await this.horses.normalize(c, h, now);
    await c.query(
      `UPDATE horses SET feed_plan = 'STANDARD', feed_paid_until = NULL, feed_renews = true, feed_periods = 0
        WHERE id = $1`,
      [h.id],
    );
    if (h.owner_id && h.feed_renews && !h.retired_at)
      await this.events.emit(c, {
        type: "feed_lapsed",
        aggregateType: "horse",
        aggregateId: h.id,
        payload: { userId: h.owner_id, horseName: h.name, plan: h.feed_plan },
      });
  }
}
