import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import {
  ClubChatRequest,
  ClubDonateRequest,
  type ClubDetailDto,
  ClubListQuery,
  type ClubSummaryDto,
  CreateClubRequest,
  type MyClubDto,
} from "@thoroughline/contracts";
import { type AuthedRequest, type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { RateLimit } from "../../common/rate-limit.js";
import { ClubsService } from "./clubs.service.js";

@Controller("clubs")
export class ClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Get()
  list(@Query() query: unknown): Promise<ClubSummaryDto[]> {
    const q = parse(ClubListQuery, query);
    return this.clubs.list(q.q, q.limit);
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser): Promise<MyClubDto> {
    return this.clubs.mine(user.id);
  }

  @Post()
  @RateLimit("auth")
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ClubDetailDto> {
    return this.clubs.create(user.id, parse(CreateClubRequest, body));
  }

  @Post("leave")
  leave(@CurrentUser() user: AuthUser): Promise<MyClubDto> {
    return this.clubs.leave(user.id);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<ClubDetailDto> {
    return this.clubs.detail(id, user.id);
  }

  @Post(":id/join")
  join(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<ClubDetailDto> {
    return this.clubs.join(user.id, id);
  }

  @Post("members/:userId/kick")
  kick(
    @CurrentUser() user: AuthUser,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Req() req: AuthedRequest,
  ): Promise<ClubDetailDto> {
    return this.clubs.kick(user.id, userId, req.ip);
  }

  /** Donate credits to your club's treasury (one-way; spent on club levels). */
  @Post("donate")
  donate(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ClubDetailDto> {
    return this.clubs.donate(user.id, parse(ClubDonateRequest, body).amount);
  }

  /** The owner spends the treasury on the next club level. */
  @Post("upgrade")
  upgrade(@CurrentUser() user: AuthUser): Promise<ClubDetailDto> {
    return this.clubs.upgrade(user.id);
  }

  /** The owner sets or clears the club's Telegram group link. */
  @Put("chat")
  chat(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ClubDetailDto> {
    return this.clubs.setChat(user.id, parse(ClubChatRequest, body).url);
  }
}
