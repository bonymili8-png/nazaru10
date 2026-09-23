import { Injectable } from "@nestjs/common";
import type { HallOfFameDto, SeasonDto, SeasonHorseRowDto, SeasonOwnerRowDto } from "@thoroughline/contracts";
import { type RaceClass, seasonAt, seasonPoints, seasonReward, seasonWindow } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";

/** Grace period after a season ends before it is closed (lets races that started in time settle). */
const CLOSE_GRACE_MS = 60 * 60_000;

interface OwnerStanding {
  owner_id: string;
  points: number;
  races: number;
  wins: number;
}

@Injectable()
export class SeasonsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  private async ensureSeason(c: Queryable, season: number): Promise<void> {
    const w = seasonWindow(season, this.config.get());
    await c.query(
      "INSERT INTO seasons (season, starts_at, ends_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [season, w.startsAt, w.endsAt],
    );
  }

  /**
   * Credit season points for a settled race (called inside the race settlement transaction).
   * The season is decided by the race start time; points belong to the owner at that moment.
   */
  async award(
    c: Queryable,
    race: { class: RaceClass; starts_at: Date },
    entries: { horseId: string; ownerId: string; position: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const cfg = this.config.get();
    const { season } = seasonAt(race.starts_at, cfg);
    await this.ensureSeason(c, season);
    for (const e of entries) {
      await c.query(
        `INSERT INTO season_points (season, horse_id, owner_id, points, races, wins, updated_at)
         VALUES ($1,$2,$3,$4,1,$5,now())
         ON CONFLICT (season, horse_id, owner_id) DO UPDATE SET points = season_points.points + EXCLUDED.points,
           races = season_points.races + 1, wins = season_points.wins + EXCLUDED.wins, updated_at = now()`,
        [season, e.horseId, e.ownerId, seasonPoints(e.position, race.class, cfg), e.position === 1 ? 1 : 0],
      );
    }
  }

  /** Owner standings: total points, tie-break by wins, then fewer races, then id (stable). */
  private standings(c: Queryable, season: number, limit: number) {
    return rows<OwnerStanding>(
      c,
      `SELECT owner_id, sum(points)::int AS points, sum(races)::int AS races, sum(wins)::int AS wins
         FROM season_points WHERE season = $1
        GROUP BY owner_id HAVING sum(points) > 0
        ORDER BY sum(points) DESC, sum(wins) DESC, sum(races) ASC, owner_id LIMIT $2`,
      [season, limit],
    );
  }

  async current(userId: string): Promise<SeasonDto> {
    const cfg = this.config.get();
    const w = seasonAt(this.clock.now(), cfg);
    const me = await this.db.one<{ points: number; races: number; wins: number }>(
      `SELECT COALESCE(sum(points),0)::int AS points, COALESCE(sum(races),0)::int AS races, COALESCE(sum(wins),0)::int AS wins
         FROM season_points WHERE season = $1 AND owner_id = $2`,
      [w.season, userId],
    );
    let rank: number | null = null;
    if (me!.points > 0) {
      const ahead = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM (
           SELECT owner_id, sum(points) AS p, sum(wins) AS w FROM season_points WHERE season = $1 GROUP BY owner_id) s
          WHERE s.p > $2 OR (s.p = $2 AND s.w > $3)`,
        [w.season, me!.points, me!.wins],
      );
      rank = ahead!.n + 1;
    }
    return {
      season: w.season,
      startsAt: w.startsAt.toISOString(),
      endsAt: w.endsAt.toISOString(),
      me: { ...me!, rank },
      rewards: cfg.seasons.rewards,
    };
  }

  async owners(season: number, limit: number, viewerId: string): Promise<SeasonOwnerRowDto[]> {
    const list = await this.standings(this.db.pool, season, limit);
    if (list.length === 0) return [];
    const names = new Map(
      (
        await this.db.query<{ id: string; name: string; stable_name: string }>(
          `SELECT u.id, COALESCE(u.username, u.first_name, 'Owner') AS name, s.name AS stable_name
             FROM users u JOIN stables s ON s.owner_id = u.id WHERE u.id = ANY($1::uuid[])`,
          [list.map((r) => r.owner_id)],
        )
      ).map((r) => [r.id, r] as const),
    );
    return list.map((r, i) => ({
      rank: i + 1,
      userId: r.owner_id,
      name: names.get(r.owner_id)?.name ?? "Owner",
      stableName: names.get(r.owner_id)?.stable_name ?? "",
      points: r.points,
      races: r.races,
      wins: r.wins,
      mine: r.owner_id === viewerId,
    }));
  }

  async horses(season: number, limit: number): Promise<SeasonHorseRowDto[]> {
    const list = await this.db.query<{
      horse_id: string;
      name: string;
      owner_name: string | null;
      points: number;
      races: number;
      wins: number;
    }>(
      `SELECT sp.horse_id, h.name, COALESCE(u.username, u.first_name) AS owner_name,
              sum(sp.points)::int AS points, sum(sp.races)::int AS races, sum(sp.wins)::int AS wins
         FROM season_points sp JOIN horses h ON h.id = sp.horse_id LEFT JOIN users u ON u.id = h.owner_id
        WHERE sp.season = $1 GROUP BY sp.horse_id, h.name, u.username, u.first_name
        HAVING sum(sp.points) > 0 ORDER BY sum(sp.points) DESC, sum(sp.wins) DESC, sp.horse_id LIMIT $2`,
      [season, limit],
    );
    return list.map((r, i) => ({
      rank: i + 1,
      horseId: r.horse_id,
      name: r.name,
      ownerName: r.owner_name,
      points: r.points,
      races: r.races,
      wins: r.wins,
    }));
  }

  /** Close finished seasons: pay rewards by final rank and record the Hall of Fame. Idempotent. */
  async closeDue(): Promise<number> {
    const due = await this.db.query<{ season: number }>(
      "SELECT season FROM seasons WHERE closed_at IS NULL AND ends_at <= $1 ORDER BY season",
      [new Date(this.clock.now().getTime() - CLOSE_GRACE_MS)],
    );
    let n = 0;
    for (const s of due) if (await this.close(s.season)) n++;
    return n;
  }

  async close(season: number): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const s = await row<{ season: number; ends_at: Date; closed_at: Date | null }>(
        c,
        "SELECT season, ends_at, closed_at FROM seasons WHERE season = $1 FOR UPDATE SKIP LOCKED",
        [season],
      );
      if (!s || s.closed_at || s.ends_at.getTime() > now.getTime() - CLOSE_GRACE_MS) return false;
      const maxRank = Math.max(0, ...cfg.seasons.rewards.map((r) => r.toRank));
      const standings = await this.standings(c, season, maxRank);
      for (const [i, st] of standings.entries()) {
        const rank = i + 1;
        const reward = seasonReward(rank, cfg);
        if (!reward) continue;
        const grants = [
          ["CREDITS", reward.credits],
          ["GEMS", reward.gems],
          ["REPUTATION", reward.reputation],
          ["PRESTIGE", reward.prestige],
        ] as const;
        for (const [currency, amount] of grants) {
          if (amount <= 0) continue;
          await this.ledger.credit(c, {
            userId: st.owner_id,
            currency,
            amount,
            source: "SEASON_REWARDS",
            key: `season:${season}:reward:${st.owner_id}:${currency}`,
            type: "SEASON_REWARD",
            reason: `Season ${season} — rank ${rank}`,
            metadata: { season, rank, points: st.points },
          });
        }
        await this.events.emit(c, {
          type: "season_reward",
          aggregateType: "season",
          aggregateId: String(season),
          payload: { userId: st.owner_id, season, rank, points: st.points, credits: reward.credits },
        });
      }
      const champion = standings[0];
      if (champion) {
        await c.query(
          "INSERT INTO hall_of_fame (season, category, user_id, value) VALUES ($1,'CHAMPION_OWNER',$2,$3)",
          [season, champion.owner_id, champion.points],
        );
      }
      // Champion horse is credited to the owner who earned most of its points.
      const topHorse = await row<{ horse_id: string; owner_id: string; points: number }>(
        c,
        `SELECT horse_id, (array_agg(owner_id ORDER BY points DESC))[1] AS owner_id, sum(points)::int AS points
           FROM season_points WHERE season = $1 GROUP BY horse_id HAVING sum(points) > 0
          ORDER BY sum(points) DESC, sum(wins) DESC, horse_id LIMIT 1`,
        [season],
      );
      if (topHorse) {
        await c.query(
          "INSERT INTO hall_of_fame (season, category, user_id, horse_id, value) VALUES ($1,'CHAMPION_HORSE',$2,$3,$4)",
          [season, topHorse.owner_id, topHorse.horse_id, topHorse.points],
        );
      }
      await c.query("UPDATE seasons SET closed_at = $2, results = $3 WHERE season = $1", [
        season,
        now,
        JSON.stringify({ top: standings.slice(0, 10) }),
      ]);
      await this.events.emit(c, {
        type: "season_closed",
        aggregateType: "season",
        aggregateId: String(season),
        payload: { entrants: standings.length },
      });
      return true;
    });
  }

  async hallOfFame(): Promise<HallOfFameDto[]> {
    const list = await this.db.query<{
      season: number;
      category: HallOfFameDto["category"];
      user_name: string | null;
      horse_id: string | null;
      horse_name: string | null;
      value: number;
    }>(
      `SELECT f.season, f.category, COALESCE(u.username, u.first_name) AS user_name, f.horse_id, h.name AS horse_name, f.value
         FROM hall_of_fame f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN horses h ON h.id = f.horse_id
        ORDER BY f.season DESC, f.category LIMIT 100`,
    );
    return list.map((r) => ({
      season: r.season,
      category: r.category,
      userName: r.user_name,
      horseId: r.horse_id,
      horseName: r.horse_name,
      value: r.value,
    }));
  }
}
