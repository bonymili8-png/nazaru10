import { Body, Controller, Get, Post } from "@nestjs/common";
import { HireLadsRequest, type StableLadsDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { LadsService } from "./lads.service.js";

/** Stable lads (gems, by the week) who do the yard round for the owner. */
@Controller("stable/lads")
export class LadsController {
  constructor(private readonly lads: LadsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<StableLadsDto> {
    return this.lads.get(user.id);
  }

  /** Hire lads for a week, pay the same team another week, or add a lad for the paid period. */
  @Post()
  hire(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<StableLadsDto> {
    return this.lads.hire(user.id, parse(HireLadsRequest, body).lads);
  }
}
