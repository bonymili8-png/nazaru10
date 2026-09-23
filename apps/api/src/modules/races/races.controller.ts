import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  EnterRaceRequest,
  type LiveRaceDto,
  type RaceDetailDto,
  RaceListQuery,
  type RaceSummaryDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { RacesService } from "./races.service.js";

@Controller("races")
export class RacesController {
  constructor(private readonly races: RacesService) {}

  @Get()
  list(@Query() query: unknown): Promise<RaceSummaryDto[]> {
    return this.races.list(parse(RaceListQuery, query));
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser): Promise<RaceSummaryDto[]> {
    return this.races.myUpcoming(user.id);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<RaceDetailDto> {
    return this.races.detail(id, user.id);
  }

  @Get(":id/live")
  live(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<LiveRaceDto> {
    return this.races.live(id, user.id);
  }

  @Post(":id/entries")
  enter(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<RaceDetailDto> {
    const req = parse(EnterRaceRequest, body);
    return this.races.enter(user.id, id, req.horseId, req.strategy);
  }

  @Delete(":id/entries/:horseId")
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("horseId", ParseUUIDPipe) horseId: string,
  ): Promise<RaceDetailDto> {
    return this.races.withdraw(user.id, id, horseId);
  }
}
