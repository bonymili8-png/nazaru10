import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  type TournamentDetailDto,
  type TournamentDto,
  TournamentHistoryQuery,
  TournamentRegisterRequest,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
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
