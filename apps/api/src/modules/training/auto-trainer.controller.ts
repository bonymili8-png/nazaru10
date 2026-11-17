import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { AutoTrainerPauseRequest, type AutoTrainerDto, BuyAutoTrainerRequest } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { AutoTrainerService } from "./auto-trainer.service.js";

/** The auto-trainer (gems, by the month) that trains the stable's free horses twice a day. */
@Controller("stable/auto-trainer")
export class AutoTrainerController {
  constructor(private readonly trainer: AutoTrainerService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<AutoTrainerDto> {
    return this.trainer.get(user.id);
  }

  /** Hire for a month (or add a month); the phone's time zone sets when it trains. */
  @Post()
  @HttpCode(200)
  buy(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<AutoTrainerDto> {
    return this.trainer.buy(user.id, parse(BuyAutoTrainerRequest, body).timezone);
  }

  @Post("pause")
  @HttpCode(200)
  pause(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<AutoTrainerDto> {
    return this.trainer.setPaused(user.id, parse(AutoTrainerPauseRequest, body).paused);
  }
}
