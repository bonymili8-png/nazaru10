import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  BuySharesRequest,
  type MyShareDto,
  type ShareOfferDto,
  ShareOfferRequest,
  type SyndicateDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { SyndicatesService } from "./syndicates.service.js";

@Controller("syndicates")
export class SyndicatesController {
  constructor(private readonly syndicates: SyndicatesService) {}

  @Get("offers")
  offers(): Promise<ShareOfferDto[]> {
    return this.syndicates.offers();
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser): Promise<MyShareDto[]> {
    return this.syndicates.mine(user.id);
  }

  @Get(":horseId")
  view(
    @CurrentUser() user: AuthUser,
    @Param("horseId", ParseUUIDPipe) horseId: string,
  ): Promise<SyndicateDto> {
    return this.syndicates.view(horseId, user.id);
  }

  @Post(":horseId/offer")
  offer(
    @CurrentUser() user: AuthUser,
    @Param("horseId", ParseUUIDPipe) horseId: string,
    @Body() body: unknown,
  ): Promise<SyndicateDto> {
    return this.syndicates.offer(user.id, horseId, parse(ShareOfferRequest, body));
  }

  @Delete(":horseId/offer")
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param("horseId", ParseUUIDPipe) horseId: string,
  ): Promise<SyndicateDto> {
    return this.syndicates.withdraw(user.id, horseId);
  }

  @Post(":horseId/buy")
  buy(
    @CurrentUser() user: AuthUser,
    @Param("horseId", ParseUUIDPipe) horseId: string,
    @Body() body: unknown,
  ): Promise<SyndicateDto> {
    return this.syndicates.buy(user.id, horseId, parse(BuySharesRequest, body).shares);
  }

  @Post(":horseId/dissolve")
  dissolve(
    @CurrentUser() user: AuthUser,
    @Param("horseId", ParseUUIDPipe) horseId: string,
  ): Promise<SyndicateDto> {
    return this.syndicates.dissolve(user.id, horseId);
  }
}
