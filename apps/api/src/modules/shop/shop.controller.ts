import { Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { HorseDetailDto, ShopHorseDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { HorsesService } from "../horses/horses.service.js";
import { ShopService } from "./shop.service.js";

@Controller("shop")
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly horses: HorsesService,
    private readonly clock: Clock,
  ) {}

  @Get("horses")
  catalog(): Promise<ShopHorseDto[]> {
    return this.shop.catalog();
  }

  @Post("horses/:id/buy")
  async buy(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<HorseDetailDto> {
    const h = await this.shop.buy(user.id, id);
    return this.horses.detail(h, user.id, this.clock.now(), null, null);
  }
}
