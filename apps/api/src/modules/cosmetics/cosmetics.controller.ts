import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import {
  ClothPatternParam,
  type CosmeticsDto,
  type SaddleCloth,
  CrestIconParam,
  SetClothRequest,
  SetCrestRequest,
  SetSilksRequest,
  SilkPatternParam,
} from "@thoroughline/contracts";
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

  @Post("crest/icons/:icon/unlock")
  unlockCrest(@CurrentUser() user: AuthUser, @Param("icon") icon: string): Promise<CosmeticsDto> {
    return this.cosmetics.unlockCrestIcon(user.id, parse(CrestIconParam, icon));
  }

  @Post("cloth/patterns/:pattern/unlock")
  unlockCloth(@CurrentUser() user: AuthUser, @Param("pattern") pattern: string): Promise<CosmeticsDto> {
    return this.cosmetics.unlockClothPattern(user.id, parse(ClothPatternParam, pattern));
  }

  @Put("horses/:id/cloth")
  setCloth(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<SaddleCloth> {
    return this.cosmetics.setCloth(user.id, id, parse(SetClothRequest, body));
  }

  @Put("crest")
  setCrest(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<CosmeticsDto> {
    return this.cosmetics.setCrest(user.id, parse(SetCrestRequest, body));
  }
}
