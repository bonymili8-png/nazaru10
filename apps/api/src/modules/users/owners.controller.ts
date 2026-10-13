import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  type Crest,
  OwnerSearchQuery,
  type OwnerCardDto,
  type PublicStableDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { notFound } from "../../common/errors.js";
import { parse } from "../../common/http.js";
import { memberSql } from "../../common/membership.js";
import { horsesByOwner } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { OffersService } from "../market/offers.service.js";

/** Find other owners and look round their stables (open to every player). */
@Controller("owners")
export class OwnersController {
  constructor(
    private readonly db: Db,
    private readonly horses: HorsesService,
    private readonly offers: OffersService,
    private readonly clock: Clock,
  ) {}

  /** Owners whose name, username or stable name contains the query. */
  @Get()
  async search(@Query() query: unknown): Promise<OwnerCardDto[]> {
    const { q } = parse(OwnerSearchQuery, query);
    // Match literally: % and _ in the query are not wildcards.
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const list = await this.db.query<{
      id: string;
      name: string;
      stable_name: string;
      crest: Crest;
      level: number;
      member: boolean;
      horses: number;
    }>(
      `SELECT u.id, COALESCE(u.username, u.first_name, 'Owner') AS name, s.name AS stable_name, s.crest, s.level,
              ${memberSql("u.id", "$2")} AS member,
              (SELECT count(*)::int FROM horses h WHERE h.owner_id = u.id AND h.retired_at IS NULL) AS horses
         FROM users u JOIN stables s ON s.owner_id = u.id
        WHERE u.status = 'ACTIVE' AND u.role <> 'SYSTEM'
          AND (lower(s.name) LIKE $1 OR lower(COALESCE(u.username, '')) LIKE $1 OR lower(COALESCE(u.first_name, '')) LIKE $1)
        ORDER BY (lower(s.name) = lower($3) OR lower(COALESCE(u.username, '')) = lower($3)) DESC, s.level DESC, s.name
        LIMIT 20`,
      [like, this.clock.now(), q],
    );
    return list.map((r) => ({
      userId: r.id,
      name: r.name,
      stableName: r.stable_name,
      crest: r.crest,
      level: r.level,
      member: r.member,
      horses: r.horses,
    }));
  }

  /** An owner's stable: every active horse with its rating (attributes only on the horse page). */
  @Get(":userId")
  async stable(
    @CurrentUser() viewer: AuthUser,
    @Param("userId", ParseUUIDPipe) userId: string,
  ): Promise<PublicStableDto> {
    const now = this.clock.now();
    const o = await this.db.one<{
      id: string;
      name: string;
      stable_name: string;
      crest: Crest;
      level: number;
      member: boolean;
      reputation: number;
    }>(
      `SELECT u.id, COALESCE(u.username, u.first_name, 'Owner') AS name, s.name AS stable_name, s.crest, s.level,
              ${memberSql("u.id", "$2")} AS member, COALESCE(a.balance, 0)::int AS reputation
         FROM users u JOIN stables s ON s.owner_id = u.id
         LEFT JOIN accounts a ON a.owner_type = 'USER' AND a.owner_id = u.id AND a.currency = 'REPUTATION'
        WHERE u.id = $1 AND u.status = 'ACTIVE' AND u.role <> 'SYSTEM'`,
      [userId, now],
    );
    if (!o) throw notFound("Stable");
    const horses = (await horsesByOwner(this.db.pool, userId)).sort(
      (a, b) => b.race_rating - a.race_rating || b.ability_rating - a.ability_rating,
    );
    const list = horses.map((h) => ({
      ...this.horses.summary(h, now, o.name),
      offerBand: this.offers.canOffer(h, viewer.id) ? this.offers.band(h, now) : null,
    }));
    return {
      userId: o.id,
      name: o.name,
      stableName: o.stable_name,
      crest: o.crest,
      level: o.level,
      reputation: o.reputation,
      member: o.member,
      isMe: o.id === viewer.id,
      record: {
        starts: list.reduce((n, h) => n + h.record.starts, 0),
        wins: list.reduce((n, h) => n + h.record.wins, 0),
        earnings: list.reduce((n, h) => n + h.record.earnings, 0),
      },
      horses: list,
    };
  }
}
