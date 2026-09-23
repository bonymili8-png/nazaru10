import { Controller, Get, Query } from "@nestjs/common";
import {
  type LeaderboardHorseDto,
  type LeaderboardOwnerDto,
  LeaderboardQuery,
} from "@thoroughline/contracts";
import { Db } from "../../common/db.js";
import { parse } from "../../common/http.js";

@Controller("leaderboard")
export class LeaderboardController {
  constructor(private readonly db: Db) {}

  @Get("horses")
  async horses(@Query() query: unknown): Promise<LeaderboardHorseDto[]> {
    const q = parse(LeaderboardQuery, query);
    const col = { rating: "h.race_rating", earnings: "h.earnings", wins: "h.wins" }[q.by];
    const list = await this.db.query<{
      id: string;
      name: string;
      owner_name: string | null;
      value: number;
      race_rating: number;
      wins: number;
      starts: number;
    }>(
      `SELECT h.id, h.name, COALESCE(u.username, u.first_name) AS owner_name, ${col} AS value, h.race_rating, h.wins, h.starts
         FROM horses h JOIN users u ON u.id = h.owner_id
        WHERE NOT h.is_house AND h.starts > 0 AND u.status = 'ACTIVE'
        ORDER BY ${col} DESC, h.id LIMIT $1`,
      [q.limit],
    );
    return list.map((r, i) => ({
      rank: i + 1,
      horseId: r.id,
      name: r.name,
      ownerName: r.owner_name,
      value: r.value,
      raceRating: r.race_rating,
      wins: r.wins,
      starts: r.starts,
    }));
  }

  @Get("owners")
  async owners(@Query() query: unknown): Promise<LeaderboardOwnerDto[]> {
    const q = parse(LeaderboardQuery, query);
    const order = { rating: "reputation", earnings: "earnings", wins: "wins" }[q.by];
    const list = await this.db.query<{
      id: string;
      name: string;
      stable_name: string;
      reputation: number;
      earnings: number;
      wins: number;
    }>(
      `SELECT u.id, COALESCE(u.username, u.first_name, 'Owner') AS name, s.name AS stable_name,
              COALESCE(a.balance, 0) AS reputation,
              COALESCE(sum(h.earnings), 0)::bigint AS earnings, COALESCE(sum(h.wins), 0)::int AS wins
         FROM users u
         JOIN stables s ON s.owner_id = u.id
         LEFT JOIN accounts a ON a.owner_type = 'USER' AND a.owner_id = u.id AND a.currency = 'REPUTATION'
         LEFT JOIN horses h ON h.owner_id = u.id
        WHERE u.status = 'ACTIVE' AND u.role <> 'SYSTEM'
        GROUP BY u.id, s.name, a.balance
        ORDER BY ${order} DESC, u.id LIMIT $1`,
      [q.limit],
    );
    return list.map((r, i) => ({
      rank: i + 1,
      userId: r.id,
      name: r.name,
      stableName: r.stable_name,
      reputation: r.reputation,
      earnings: r.earnings,
      wins: r.wins,
    }));
  }
}
