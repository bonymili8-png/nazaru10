import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  type TournamentDetailDto,
  type TournamentDto,
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
