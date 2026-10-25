import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import {
  type LiveRaceDto,
  type PublicHorseDto,
  type RaceDetailDto,
  ShareVisitRequest,
  type ViralStatsDto,
} from "@thoroughline/contracts";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { Public, Roles } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { ShareService } from "./share.service.js";

/**
 * Read-only pages anyone can open from a shared link (no sign-in): a finished race's replay, a
 * horse's card, and the preview images chat apps and social networks show for those links.
 */
@Public()
@Controller("public")
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Get("races/:id")
  race(@Param("id", ParseUUIDPipe) id: string): Promise<RaceDetailDto> {
    return this.share.race(id);
  }

  @Get("races/:id/live")
  live(@Param("id", ParseUUIDPipe) id: string): Promise<LiveRaceDto> {
    return this.share.live(id);
  }

  @Get("horses/:id")
  horse(@Param("id", ParseUUIDPipe) id: string): Promise<PublicHorseDto> {
    return this.share.horse(id);
  }

  @Get("og/race/:id")
  async raceImage(
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const png = await this.share.raceImage(id);
    void reply.header("content-type", "image/png").header("cache-control", "public, max-age=86400");
    return png;
  }

  @Get("og/horse/:id")
  async horseImage(
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const png = await this.share.horseImage(id);
    void reply.header("content-type", "image/png").header("cache-control", "public, max-age=600");
    return png;
  }

  /** A share page was opened (counted once per page view by the page itself). */
  @Post("share-visits")
  @HttpCode(204)
  async visit(@Body() body: unknown): Promise<void> {
    await this.share.visit(parse(ShareVisitRequest, body));
  }
}

const ViralQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

/** The viral loop on the admin console's players tab. */
@Controller("admin/viral")
export class ViralAdminController {
  constructor(private readonly share: ShareService) {}

  @Get()
  @Roles("ECONOMY_ADMIN", "FINANCE_ADMIN", "GAME_ADMIN")
  stats(@Query() query: unknown): Promise<ViralStatsDto> {
    return this.share.viral(parse(ViralQuery, query).days);
  }
}
