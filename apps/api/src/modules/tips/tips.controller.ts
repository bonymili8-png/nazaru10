import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { type RaceTipsDto, TipRequest, type TipsDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { TipsService } from "./tips.service.js";

/** Tipster league: free predictions, scored for points, with a weekly table. */
@Controller()
export class TipsController {
  constructor(private readonly tips: TipsService) {}

  @Get("tips")
  league(@CurrentUser() user: AuthUser): Promise<TipsDto> {
    return this.tips.league(user.id);
  }

  @Get("races/:id/tips")
  race(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<RaceTipsDto> {
    return this.tips.forRace(user.id, id);
  }

  /** Place or change the tip on a race (until the off). */
  @Put("races/:id/tips")
  tip(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<RaceTipsDto> {
    return this.tips.tip(user.id, id, parse(TipRequest, body).picks);
  }
}
