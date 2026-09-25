import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { type CosmeticsDto, SetSilksRequest, SilkPatternParam } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { CosmeticsService } from "./cosmetics.service.js";

@Controller("cosmetics")
export class CosmeticsController {
  constructor(private readonly cosmetics: CosmeticsService) {}

  @Get()
  view(@CurrentUser() user: AuthUser): Promise<CosmeticsDto> {
    return this.cosmetics.view(user.id);
  }

  @Post("silks/patterns/:pattern/unlock")
  unlock(@CurrentUser() user: AuthUser, @Param("pattern") pattern: string): Promise<CosmeticsDto> {
    return this.cosmetics.unlockPattern(user.id, parse(SilkPatternParam, pattern));
  }

  @Put("silks")
  setSilks(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<CosmeticsDto> {
    return this.cosmetics.setSilks(user.id, parse(SetSilksRequest, body));
  }
}
