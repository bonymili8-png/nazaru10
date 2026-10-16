import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import {
  AdminGemExchangeToggle,
  type AdminGemExchangeDto,
  type GemExchangeDto,
  GemExchangeRequest,
  type GemExchangeResultDto,
} from "@thoroughline/contracts";
import { type AuthedRequest, type AuthUser, CurrentUser, Roles } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { ExchangeService } from "./exchange.service.js";

/** Owners buy credits with gems (shop, gems tab). */
@Controller("wallet/exchange")
export class ExchangeController {
  constructor(private readonly exchange: ExchangeService) {}

  @Get()
  offer(@CurrentUser() user: AuthUser): Promise<GemExchangeDto> {
    return this.exchange.offer(user.id);
  }

  @Post()
  buy(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<GemExchangeResultDto> {
    return this.exchange.buy(user.id, parse(GemExchangeRequest, body));
  }
}

/** The admin's on/off switch and what the exchange moved (admin console, economy tab). */
@Controller("admin/gem-exchange")
export class ExchangeAdminController {
  constructor(private readonly exchange: ExchangeService) {}

  @Get()
  @Roles("ECONOMY_ADMIN", "FINANCE_ADMIN")
  view(): Promise<AdminGemExchangeDto> {
    return this.exchange.adminView();
  }

  @Post()
  @Roles("ECONOMY_ADMIN")
  set(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<AdminGemExchangeDto> {
    return this.exchange.setEnabled(user.id, parse(AdminGemExchangeToggle, body), req.ip ?? null);
  }
}
