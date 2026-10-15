import { Injectable } from "@nestjs/common";
import type { RaceTipsDto, TipsDto, TipsterRowDto } from "@thoroughline/contracts";
import { scoreTip, tipsterWeek, tipValues } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { badRequest, conflict, notFound } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";

interface TipRow {
  user_id: string;
  race_id: string;
  picks: string[];
  week: Date;
  created_at: Date;
  scored_at: Date | null;
  points: number | null;
  slots: number[] | null;
  tricast: number | null;
  void: boolean;
}

interface RaceLite {
  id: string;
  name: string;
  status: "OPEN" | "LOCKED" | "RUNNING" | "COMPLETED" | "CANCELLED";
  starts_at: Date;
}

const WEEK_MS = 7 * 86_400_000;
/** Close a week this long after it ends, so its last races have settled. */
const CLOSE_AFTER_MS = 3 * 3_600_000;

/**
 * Tipster league (engine tipster/): predict the first three of upcoming races with players'
 * horses, for points only. Tips close at the off; they are scored once the race is settled; the
 * weekly table (Monday–Sunday, UTC) pays small rewards in gems and reputation when it closes.
 */
@Injectable()
export class TipsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly clock: Clock,
  ) {}

  /* ───────────────────────────── one race ───────────────────────────── */

  /** Runners' tip values from strength: frozen at the lock (snapshot), live until then. */
  private async values(c: Queryable, raceId: string) {
    const field = await rows<{ id: string; strength: number }>(
      c,
      `SELECT e.horse_id AS id, COALESCE((e.snapshot->>'abilityRating')::real, h.ability_rating) AS strength
         FROM race_entries e JOIN horses h ON h.id = e.horse_id
        WHERE e.race_id = $1 AND e.status IN ('ENTERED', 'RAN')`,
      [raceId],
    );
    return tipValues(field, this.config.get());
  }

  private async race(c: Queryable, raceId: string): Promise<RaceLite> {
    const r = await row<RaceLite>(c, "SELECT id, name, status, starts_at FROM races WHERE id = $1", [raceId]);
    if (!r) throw notFound("Race");
    return r;
  }

  /** Open for tips: before the off, entries or the field still to come, with a player's horse. */
  private async tippable(c: Queryable, r: RaceLite, now: Date): Promise<boolean> {
    if ((r.status !== "OPEN" && r.status !== "LOCKED") || r.starts_at <= now) return false;
    const players = await row<{ n: number }>(
      c,
      "SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1 AND status = 'ENTERED' AND NOT is_house",
      [r.id],
    );
    return players!.n > 0;
  }

  private async dailyLeft(c: Queryable, userId: string, now: Date, exceptRaceId: string | null = null) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const used = await row<{ n: number }>(
      c,
      `SELECT count(*)::int AS n FROM tips
        WHERE user_id = $1 AND created_at >= $2 AND ($3::uuid IS NULL OR race_id <> $3)`,
      [userId, day, exceptRaceId],
    );
    return Math.max(0, this.config.get().tipster.dailyLimit - used!.n);
  }

  async forRace(userId: string, raceId: string): Promise<RaceTipsDto> {
    await this.scoreDue();
    const now = this.clock.now();
    const r = await this.race(this.db.pool, raceId);
    const values = await this.values(this.db.pool, raceId);
    const mine = await row<TipRow>(this.db.pool, "SELECT * FROM tips WHERE user_id = $1 AND race_id = $2", [
      userId,
      raceId,
    ]);
    const n = await row<{ n: number }>(
      this.db.pool,
      "SELECT count(*)::int AS n FROM tips WHERE race_id = $1",
      [raceId],
    );
    return {
      open: await this.tippable(this.db.pool, r, now),
      closesAt: r.starts_at.toISOString(),
      final: r.status !== "OPEN",
      values: [...values].map(([horseId, value]) => ({ horseId, value })),
      myTip: mine
        ? {
            picks: mine.picks,
            points: mine.scored_at ? mine.points : null,
            slots: mine.scored_at ? mine.slots : null,
            tricast: mine.tricast ?? 0,
            void: mine.void,
          }
        : null,
      tipsters: n!.n,
      dailyLeft: await this.dailyLeft(this.db.pool, userId, now, raceId),
    };
  }

  /** Place or change a tip (until the off). New tips count against the daily limit. */
  async tip(userId: string, raceId: string, picks: string[]): Promise<RaceTipsDto> {
    if (new Set(picks).size !== picks.length) throw badRequest("DUPLICATE_PICK", "Pick different runners");
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const r = await row<RaceLite>(
        c,
        "SELECT id, name, status, starts_at FROM races WHERE id = $1 FOR UPDATE",
        [raceId],
      );
      if (!r) throw notFound("Race");
      if (!(await this.tippable(c, r, now))) throw conflict("TIPS_CLOSED", "Tips for this race are closed");
      const runners = await rows<{ horse_id: string }>(
        c,
        "SELECT horse_id FROM race_entries WHERE race_id = $1 AND status = 'ENTERED'",
        [raceId],
      );
      const ids = new Set(runners.map((x) => x.horse_id));
      if (!picks.every((p) => ids.has(p))) throw badRequest("NOT_A_RUNNER", "Pick runners in this race");
      // Serialise one player's tips so the daily limit holds.
      await c.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      const existing = await row(c, "SELECT 1 FROM tips WHERE user_id = $1 AND race_id = $2", [
        userId,
        raceId,
      ]);
      if (!existing && (await this.dailyLeft(c, userId, now)) <= 0)
        throw conflict("TIP_LIMIT", `Up to ${this.config.get().tipster.dailyLimit} new tips a day`);
      await c.query(
        `INSERT INTO tips (user_id, race_id, picks, week, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (user_id, race_id) DO UPDATE SET picks = EXCLUDED.picks, updated_at = EXCLUDED.updated_at`,
        [userId, raceId, picks, tipsterWeek(r.starts_at), now],
      );
    });
    return this.forRace(userId, raceId);
  }

  /* ───────────────────────────── scoring and weeks ───────────────────────────── */

  /** Score tips on races that have finished (or void them on races called off). */
  async scoreDue(limit = 50): Promise<number> {
    const races = await rows<{ id: string; status: string }>(
      this.db.pool,
      `SELECT DISTINCT r.id, r.status FROM tips t JOIN races r ON r.id = t.race_id
        WHERE t.scored_at IS NULL AND r.status IN ('COMPLETED', 'CANCELLED') LIMIT $1`,
      [limit],
    );
    const cfg = this.config.get();
    const now = this.clock.now();
    let n = 0;
    for (const r of races)
      n += await this.db.tx(async (c) => {
        const tips = await rows<TipRow>(
          c,
          "SELECT * FROM tips WHERE race_id = $1 AND scored_at IS NULL FOR UPDATE SKIP LOCKED",
          [r.id],
        );
        if (!tips.length) return 0;
        if (r.status === "CANCELLED") {
          await c.query(
            "UPDATE tips SET scored_at = $2, points = 0, slots = '{}', tricast = 0, void = true WHERE race_id = $1 AND scored_at IS NULL",
            [r.id, now],
          );
          return tips.length;
        }
        const values = await this.values(c, r.id);
        const positions = new Map(
          (
            await rows<{ horse_id: string; position: number }>(
              c,
              "SELECT horse_id, position FROM race_entries WHERE race_id = $1 AND status = 'RAN' AND position IS NOT NULL",
              [r.id],
            )
          ).map((x) => [x.horse_id, x.position] as const),
        );
        for (const t of tips) {
          const s = scoreTip(t.picks, positions, values, cfg);
          await c.query(
            "UPDATE tips SET scored_at = $3, points = $4, slots = $5, tricast = $6 WHERE user_id = $1 AND race_id = $2",
            [t.user_id, t.race_id, now, s.points, s.slots, s.tricast],
          );
        }
        return tips.length;
      });
    return n;
  }

  /** The table of a week: players by points, then winners, then fewer tips. */
  private async table(week: Date, limit: number, viewerId: string | null): Promise<TipsterRowDto[]> {
    const list = await rows<{ user_id: string; name: string; points: number; tips: number; winners: number }>(
      this.db.pool,
      `SELECT t.user_id, COALESCE(u.username, u.first_name, 'Owner') AS name,
              sum(t.points)::int AS points, count(*)::int AS tips,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM race_entries e WHERE e.race_id = t.race_id
                              AND e.horse_id = t.picks[1] AND e.position = 1))::int AS winners
         FROM tips t JOIN users u ON u.id = t.user_id
        WHERE t.week = $1 AND t.scored_at IS NOT NULL AND NOT t.void
        GROUP BY t.user_id, u.username, u.first_name
       HAVING sum(t.points) > 0
        ORDER BY points DESC, winners DESC, tips ASC, t.user_id
        LIMIT $2`,
      [week, limit],
    );
    return list.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      name: r.name,
      points: r.points,
      tips: r.tips,
      winners: r.winners,
      me: r.user_id === viewerId,
    }));
  }

  /** Close finished weeks: final table, rewards in gems and reputation (once per week). */
  async closeWeeks(): Promise<number> {
    const now = this.clock.now();
    const current = tipsterWeek(now);
    const due = await rows<{ week: Date }>(
      this.db.pool,
      `SELECT DISTINCT t.week FROM tips t
        WHERE t.week < $1 AND NOT EXISTS (SELECT 1 FROM tipster_weeks w WHERE w.week = t.week)
        ORDER BY t.week LIMIT 4`,
      [current],
    );
    const rewards = this.config.get().tipster.weeklyRewards;
    let n = 0;
    for (const { week } of due) {
      if (now.getTime() < week.getTime() + WEEK_MS + CLOSE_AFTER_MS) continue;
      await this.scoreDue(500);
      const top = await this.table(week, rewards.length, null);
      const closed = await this.db.tx(async (c) => {
        const ins = await row(
          c,
          "INSERT INTO tipster_weeks (week, closed_at, winners) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING week",
          [week, now, JSON.stringify(top)],
        );
        if (!ins) return false;
        const label = week.toISOString().slice(0, 10);
        for (const t of top) {
          const r = rewards[t.rank - 1]!;
          for (const [currency, amount] of [
            ["GEMS", r.gems],
            ["REPUTATION", r.reputation],
          ] as const)
            if (amount > 0)
              await this.ledger.credit(c, {
                userId: t.userId,
                currency,
                amount,
                source: "TIPSTER_REWARDS",
                key: `tipster:${label}:${t.userId}:${currency}`,
                type: "TIPSTER_REWARD",
                reason: `Tipster league week of ${label}: #${t.rank}`,
              });
        }
        return true;
      });
      if (closed) n++;
    }
    return n;
  }

  /* ───────────────────────────── the league page ───────────────────────────── */

  async league(userId: string): Promise<TipsDto> {
    await this.scoreDue();
    await this.closeWeeks();
    const cfg = this.config.get().tipster;
    const now = this.clock.now();
    const week = tipsterWeek(now);
    const table = await this.table(week, 20, userId);
    const all = await this.table(week, 10_000, userId);
    const meRow = all.find((r) => r.me);
    const mineAll = await row<{ tips: number }>(
      this.db.pool,
      "SELECT count(*)::int AS tips FROM tips WHERE user_id = $1 AND week = $2 AND NOT void",
      [userId, week],
    );
    const upcoming = await rows<{
      id: string;
      name: string;
      class: TipsDto["upcoming"][number]["class"];
      starts_at: Date;
      runners: number;
      tipped: boolean;
    }>(
      this.db.pool,
      `SELECT r.id, r.name, r.class, r.starts_at,
              (SELECT count(*)::int FROM race_entries e WHERE e.race_id = r.id AND e.status = 'ENTERED') AS runners,
              EXISTS (SELECT 1 FROM tips t WHERE t.race_id = r.id AND t.user_id = $3) AS tipped
         FROM races r
        WHERE r.status IN ('OPEN', 'LOCKED') AND r.starts_at > $1 AND r.starts_at <= $2
          AND EXISTS (SELECT 1 FROM race_entries e WHERE e.race_id = r.id AND e.status = 'ENTERED' AND NOT e.is_house)
        ORDER BY r.starts_at LIMIT 20`,
      [now, new Date(now.getTime() + 90 * 60_000), userId],
    );
    const myTips = await rows<TipRow & { race_name: string; starts_at: Date; names: string[] }>(
      this.db.pool,
      `SELECT t.*, r.name AS race_name, r.starts_at,
              ARRAY(SELECT h.name FROM unnest(t.picks) WITH ORDINALITY p(id, i) JOIN horses h ON h.id = p.id ORDER BY p.i) AS names
         FROM tips t JOIN races r ON r.id = t.race_id
        WHERE t.user_id = $1 ORDER BY r.starts_at DESC LIMIT 20`,
      [userId],
    );
    const last = await row<{ winners: TipsterRowDto[] }>(
      this.db.pool,
      "SELECT winners FROM tipster_weeks WHERE week = $1",
      [new Date(week.getTime() - WEEK_MS)],
    );
    return {
      weekStart: week.toISOString(),
      weekEnd: new Date(week.getTime() + WEEK_MS).toISOString(),
      dailyLimit: cfg.dailyLimit,
      dailyLeft: await this.dailyLeft(this.db.pool, userId, now),
      me: {
        rank: meRow?.rank ?? null,
        points: meRow?.points ?? 0,
        tips: mineAll!.tips,
        winners: meRow?.winners ?? 0,
      },
      table,
      lastWeek: (last?.winners ?? []).slice(0, 3).map((r) => ({ ...r, me: r.userId === userId })),
      rewards: cfg.weeklyRewards,
      rules: {
        placeExact: cfg.placeExact,
        placeAny: cfg.placeAny,
        tricastBonus: cfg.tricastBonus,
        minValue: cfg.minValue,
        maxValue: cfg.maxValue,
      },
      upcoming: upcoming.map((r) => ({
        raceId: r.id,
        name: r.name,
        class: r.class,
        startsAt: r.starts_at.toISOString(),
        runners: r.runners,
        tipped: r.tipped,
      })),
      myTips: myTips.map((t) => ({
        raceId: t.race_id,
        raceName: t.race_name,
        startsAt: t.starts_at.toISOString(),
        status: t.void ? "VOID" : t.scored_at ? "SCORED" : "PENDING",
        picks: t.picks.map((id, i) => ({ horseId: id, horseName: t.names[i] ?? "—" })),
        points: t.scored_at ? t.points : null,
      })),
    };
  }
}
