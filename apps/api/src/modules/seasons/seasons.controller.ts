import { Controller, Get, Param, ParseIntPipe, Query } from "@nestjs/common";
import {
  type HallOfFameDto,
  SeasonBoardQuery,
  type SeasonDto,
  type SeasonHorseRowDto,
  type SeasonOwnerRowDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { SeasonsService } from "./seasons.service.js";

@Controller()
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get("seasons/current")
  current(@CurrentUser() user: AuthUser): Promise<SeasonDto> {
    return this.seasons.current(user.id);
  }

  @Get("seasons/:season/leaderboard")
  board(
    @CurrentUser() user: AuthUser,
    @Param("season", ParseIntPipe) season: number,
    @Query() query: unknown,
  ): Promise<SeasonOwnerRowDto[] | SeasonHorseRowDto[]> {
    const q = parse(SeasonBoardQuery, query);
    return q.kind === "owners"
      ? this.seasons.owners(season, q.limit, user.id)
      : this.seasons.horses(season, q.limit);
  }

  @Get("hall-of-fame")
  hallOfFame(): Promise<HallOfFameDto[]> {
    return this.seasons.hallOfFame();
  }
}
