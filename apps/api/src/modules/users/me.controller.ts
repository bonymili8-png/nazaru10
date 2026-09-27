import { Body, Controller, Get, Put } from "@nestjs/common";
import {
  type FollowedHorseDto,
  type HomeDto,
  type ReferralDto,
  UpdateSettingsRequest,
  type UserDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { notFound } from "../../common/errors.js";
import { parse } from "../../common/http.js";
import { memberSql } from "../../common/membership.js";
import { toUserDto } from "../auth/auth.service.js";
import { LedgerService } from "../economy/ledger.service.js";
import { type HorseRow, horsesByOwner } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { QuestsService } from "../quests/quests.service.js";
import { RacesService } from "../races/races.service.js";
import { StableService } from "../stable/stable.service.js";
import { TrainingService } from "../training/training.service.js";
import type { UserRow } from "./onboarding.service.js";
import { ReferralsService } from "./referrals.service.js";

@Controller()
export class MeController {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly stables: StableService,
    private readonly horses: HorsesService,
    private readonly training: TrainingService,
    private readonly races: RacesService,
    private readonly quests: QuestsService,
    private readonly clock: Clock,
    private readonly referrals: ReferralsService,
  ) {}

  private async user(id: string): Promise<UserDto> {
    const u = await this.db.one<UserRow & { member: boolean }>(
      `SELECT u.*, ${memberSql("u.id", "$2")} AS member FROM users u WHERE u.id = $1`,
      [id, this.clock.now()],
    );
    if (!u) throw notFound("User");
    return toUserDto(u);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.user(user.id);
  }

  /** Friends this player invited and the state of each invite reward. */
  /** Horses the player follows, each with its next race (if entered). */
  @Get("me/follows")
  async follows(@CurrentUser() user: AuthUser): Promise<FollowedHorseDto[]> {
    const now = this.clock.now();
    const list = await this.db.query<
      HorseRow & {
        owner_name: string | null;
        race_id: string | null;
        race_name: string | null;
        starts_at: Date | null;
      }
    >(
      `SELECT h.*, COALESCE(u.username, u.first_name) AS owner_name, nr.id AS race_id, nr.name AS race_name,
              nr.starts_at
         FROM horse_follows f
         JOIN horses h ON h.id = f.horse_id
         LEFT JOIN users u ON u.id = h.owner_id
         LEFT JOIN LATERAL (
           SELECT r.id, r.name, r.starts_at FROM race_entries e JOIN races r ON r.id = e.race_id
            WHERE e.horse_id = h.id AND e.status = 'ENTERED' AND r.status IN ('OPEN','LOCKED','RUNNING')
            ORDER BY r.starts_at LIMIT 1
         ) nr ON true
        WHERE f.user_id = $1
        ORDER BY nr.starts_at NULLS LAST, f.created_at DESC`,
      [user.id],
    );
    return list.map((h) => ({
      horse: this.horses.summary(h, now, h.owner_name),
      nextRace: h.race_id
        ? { id: h.race_id, name: h.race_name!, startsAt: h.starts_at!.toISOString() }
        : null,
    }));
  }

  @Get("me/referrals")
  myReferrals(@CurrentUser() user: AuthUser): Promise<ReferralDto[]> {
    return this.referrals.list(user.id);
  }

  /** Personal preferences (language, notifications). A null locale means "follow Telegram". */
  @Put("me/settings")
  async updateSettings(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<UserDto> {
    const req = parse(UpdateSettingsRequest, body);
    const patch: Record<string, unknown> = {};
    if (req.notifications !== undefined) patch.notifications = req.notifications;
    if (req.locale !== undefined) patch.locale = req.locale;
    await this.db.query(
      `UPDATE users SET settings = jsonb_strip_nulls(settings || $2::jsonb), updated_at = $3 WHERE id = $1`,
      [user.id, JSON.stringify(patch), this.clock.now()],
    );
    return this.user(user.id);
  }

  /** One round-trip for the home screen. */
  @Get("home")
  async home(@CurrentUser() user: AuthUser): Promise<HomeDto> {
    await this.training.settleDueForOwner(user.id);
    const now = this.clock.now();
    const horses = await horsesByOwner(this.db.pool, user.id);
    const active = await this.training.active(
      this.db.pool,
      horses.map((h) => h.id),
    );
    const [u, balances, stable, upcoming, quests] = await Promise.all([
      this.user(user.id),
      this.ledger.balances(user.id),
      this.stables.view(user.id),
      this.races.myUpcoming(user.id),
      this.quests.list(user.id),
    ]);
    return {
      user: u,
      wallet: { balances },
      stable,
      horses: horses.map((h) => this.horses.summary(h, now)),
      activeTraining: [...active.values()],
      myUpcomingRaces: upcoming,
      quests,
    };
  }
}
