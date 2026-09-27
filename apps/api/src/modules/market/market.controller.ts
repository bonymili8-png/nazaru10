import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  BidRequest,
  CreateListingRequest,
  type MarketListingDetailDto,
  type MarketListingDto,
  type HorseOfferDto,
  type MarketMineDto,
  type OffersDto,
  MarketQuery,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { MarketService } from "./market.service.js";
import { OffersService } from "./offers.service.js";

@Controller("market")
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly offersService: OffersService,
  ) {}

  @Get("listings")
  list(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<MarketListingDto[]> {
    return this.market.list(parse(MarketQuery, query), user.id);
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser): Promise<MarketMineDto> {
    return this.market.mine(user.id);
  }

  @Get("sales")
  async sales() {
    return (await this.market.recentSales()).map((s) => ({ ...s, closed_at: s.closed_at.toISOString() }));
  }

  @Get("listings/:id")
  detail(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<MarketListingDetailDto> {
    return this.market.detail(id, user.id);
  }

  @Post("listings")
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<MarketListingDetailDto> {
    return this.market.create(user.id, parse(CreateListingRequest, body));
  }

  @Post("listings/:id/cancel")
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<MarketListingDetailDto> {
    return this.market.cancel(user.id, id);
  }

  @Post("listings/:id/feature")
  feature(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<MarketListingDetailDto> {
    return this.market.feature(user.id, id);
  }

  @Post("listings/:id/buy")
  buy(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<MarketListingDetailDto> {
    return this.market.buy(user.id, id);
  }

  @Post("listings/:id/bids")
  bid(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<MarketListingDetailDto> {
    return this.market.bid(user.id, id, parse(BidRequest, body).amount);
  }

  /** The player's offers: received on their horses and made on others'. */
  @Get("offers")
  offers(@CurrentUser() user: AuthUser): Promise<OffersDto> {
    return this.offersService.mine(user.id);
  }

  @Post("offers/:id/accept")
  accept(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<HorseOfferDto> {
    return this.offersService.accept(user.id, id);
  }

  @Post("offers/:id/decline")
  decline(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<HorseOfferDto> {
    return this.offersService.decline(user.id, id);
  }

  @Post("offers/:id/withdraw")
  withdraw(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<HorseOfferDto> {
    return this.offersService.withdraw(user.id, id);
  }
}
