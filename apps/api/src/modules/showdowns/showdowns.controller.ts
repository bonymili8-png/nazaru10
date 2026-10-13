import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  CallShowdownRaceRequest,
  CreateShowdownRequest,
  JoinShowdownRequest,
  type LiveRaceDto,
  type ShowdownDto,
  SetShowdownHorsesRequest,
  ShowdownTacticsRequest,
  type ShowdownSummaryDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser, Public } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { ShowdownsService } from "./showdowns.service.js";

/** Showdowns for players (signed in through the Mini App). */
@Controller("showdowns")
export class ShowdownsController {
  constructor(private readonly showdowns: ShowdownsService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser): Promise<ShowdownSummaryDto[]> {
    return this.showdowns.mine(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ShowdownDto> {
    return this.showdowns.create(user.id, parse(CreateShowdownRequest, body));
  }

  @Get(":code")
  get(@CurrentUser() user: AuthUser, @Param("code") code: string): Promise<ShowdownDto> {
    return this.showdowns.get(code.toUpperCase(), user.id);
  }

  @Post(":code/join")
  join(
    @CurrentUser() user: AuthUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<ShowdownDto> {
    const req = parse(JoinShowdownRequest, body);
    return this.showdowns.join(user.id, code.toUpperCase(), req.displayName, req.horseIds);
  }

  /** OWN_HORSES: change the horses you enter, between races. */
  @Post(":code/horses")
  horses(
    @CurrentUser() user: AuthUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<ShowdownDto> {
    return this.showdowns.setHorses(
      user.id,
      code.toUpperCase(),
      parse(SetShowdownHorsesRequest, body).horseIds,
    );
  }

  @Post(":code/races")
  call(
    @CurrentUser() user: AuthUser,
    @Param("code") code: string,
    @Body() body: unknown,
  ): Promise<ShowdownDto> {
    return this.showdowns.callRace(user.id, code.toUpperCase(), parse(CallShowdownRaceRequest, body));
  }

  @Post(":code/races/:raceId/tactics")
  tactics(
    @CurrentUser() user: AuthUser,
    @Param("code") code: string,
    @Param("raceId", ParseUUIDPipe) raceId: string,
    @Body() body: unknown,
  ): Promise<ShowdownDto> {
    const req = parse(ShowdownTacticsRequest, body);
    return this.showdowns.setTactics(user.id, code.toUpperCase(), raceId, req.strategy, req.horseId);
  }

  @Get(":code/races/:raceId/live")
  live(
    @CurrentUser() user: AuthUser,
    @Param("code") code: string,
    @Param("raceId", ParseUUIDPipe) raceId: string,
  ): Promise<LiveRaceDto> {
    return this.showdowns.live(code.toUpperCase(), raceId, user.id);
  }

  @Delete(":code/players/:userId")
  kick(
    @CurrentUser() user: AuthUser,
    @Param("code") code: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ): Promise<ShowdownDto> {
    return this.showdowns.kick(user.id, code.toUpperCase(), userId);
  }

  @Post(":code/finish")
  finish(@CurrentUser() user: AuthUser, @Param("code") code: string): Promise<ShowdownDto> {
    return this.showdowns.finish(user.id, code.toUpperCase());
  }
}

/**
 * The public broadcast of a showdown: read-only, no sign-in, so a streamer can open it in any
 * browser (TikTok Live, OBS) and viewers can follow a shared link.
 */
@Public()
@Controller("public/showdowns")
export class PublicShowdownsController {
  constructor(private readonly showdowns: ShowdownsService) {}

  @Get(":code")
  get(@Param("code") code: string): Promise<ShowdownDto> {
    return this.showdowns.get(code.toUpperCase(), null);
  }

  @Get(":code/races/:raceId/live")
  live(@Param("code") code: string, @Param("raceId", ParseUUIDPipe) raceId: string): Promise<LiveRaceDto> {
    return this.showdowns.live(code.toUpperCase(), raceId, null);
  }
}
