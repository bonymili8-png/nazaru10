import { Body, Controller, Get, Put } from "@nestjs/common";
import { type HomeDto, UpdateSettingsRequest, type UserDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { notFound } from "../../common/errors.js";
import { parse } from "../../common/http.js";
import { toUserDto } from "../auth/auth.service.js";
import { LedgerService } from "../economy/ledger.service.js";
import { horsesByOwner } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { QuestsService } from "../quests/quests.service.js";
import { RacesService } from "../races/races.service.js";
import { StableService } from "../stable/stable.service.js";
import { TrainingService } from "../training/training.service.js";
import type { UserRow } from "./onboarding.service.js";

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
  ) {}

  private async user(id: string): Promise<UserDto> {
    const u = await this.db.one<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    if (!u) throw notFound("User");
    return toUserDto(u);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.user(user.id);
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
