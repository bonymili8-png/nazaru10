import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import {
  type AdminSwitchDto,
  AdminSwitchToggle,
  type TournamentDetailDto,
  type TournamentDto,
  TournamentHistoryQuery,
  TournamentRegisterRequest,
} from "@thoroughline/contracts";
import { type AuthedRequest, type AuthUser, CurrentUser, Roles } from "../../common/auth.js";
import { ConfigSwitchService } from "../../common/config-switch.js";
import { parse } from "../../common/http.js";
import { TournamentsService } from "./tournaments.service.js";

@Controller("tournaments")
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<TournamentDto[]> {
    return this.tournaments.list(user.id);
  }

  /** Finished tournaments, newest first; `mine=true` keeps those the viewer had a horse in. */
  @Get("history")
  history(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<{ items: TournamentDto[]; nextBefore: string | null }> {
    return this.tournaments.history(user.id, parse(TournamentHistoryQuery, query));
  }

  @Get(":id")
  detail(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.detail(id, user.id);
  }

  @Post(":id/entries")
  register(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<TournamentDetailDto> {
    const req = parse(TournamentRegisterRequest, body);
    return this.tournaments.register(user.id, id, req.horseId, req.strategy);
  }

  @Delete(":id/entries/:horseId")
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("horseId", ParseUUIDPipe) horseId: string,
  ): Promise<TournamentDetailDto> {
    return this.tournaments.withdraw(user.id, id, horseId);
  }
}

const HOUSE_FILL = ["tournaments", "houseFill", "enabled"] as const;
const HOUSE_FILL_ACTION = "TOURNAMENT_HOUSE_FILL_SWITCH";

/** Admin switch: cups run with one entrant and full house-filled fields (races tab). */
@Controller("admin/tournament-house-fill")
export class TournamentsAdminController {
  constructor(private readonly switches: ConfigSwitchService) {}

  @Get()
  @Roles("GAME_ADMIN", "TOURNAMENT_ADMIN")
  async view(): Promise<AdminSwitchDto> {
    return {
      enabled: this.switches.get(HOUSE_FILL),
      history: await this.switches.history(HOUSE_FILL_ACTION),
    };
  }

  @Post()
  @Roles("GAME_ADMIN", "TOURNAMENT_ADMIN")
  async set(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<AdminSwitchDto> {
    const b = parse(AdminSwitchToggle, body);
    await this.switches.set(HOUSE_FILL, HOUSE_FILL_ACTION, {
      actorId: user.id,
      enabled: b.enabled,
      note: b.note || (b.enabled ? "Tournaments: house horses fill the field" : "Tournaments: entrants only"),
      ip: req.ip ?? null,
    });
    return this.view();
  }
}
