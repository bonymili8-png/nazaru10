import { Controller, Get, Query } from "@nestjs/common";
import { type FeedItemDto, FeedQuery } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { FeedService } from "./feed.service.js";

@Controller("feed")
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<FeedItemDto[]> {
    const q = parse(FeedQuery, query);
    return this.feed.list(user.id, q.scope, q.limit);
  }
}
