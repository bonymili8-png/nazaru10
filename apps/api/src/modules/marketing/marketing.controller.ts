import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import {
  type MarketingAdminDto,
  MarketingChannelRequest,
  MarketingSwitchRequest,
} from "@thoroughline/contracts";
import type { FastifyReply } from "fastify";
import { type AuthedRequest, type AuthUser, CurrentUser, Roles } from "../../common/auth.js";
import { badRequest } from "../../common/errors.js";
import { parse } from "../../common/http.js";
import { MarketingService } from "./marketing.service.js";

const TEAM = ["CONTENT_ADMIN", "ECONOMY_ADMIN"] as const;

const itemId = (id: string) => {
  if (!/^\d{1,18}$/.test(id)) throw badRequest("BAD_ID", "Not a post id");
  return id;
};

/** Admin console → marketing: the game's own channel, its switches, queue and history. */
@Controller("admin/marketing")
export class MarketingAdminController {
  constructor(private readonly marketing: MarketingService) {}

  @Get()
  @Roles(...TEAM)
  view(): Promise<MarketingAdminDto> {
    return this.marketing.view();
  }

  @Post("switch")
  @Roles(...TEAM)
  switch(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: AuthedRequest) {
    const b = parse(MarketingSwitchRequest, body);
    return this.marketing.setSwitch(u.id, b.key, b.enabled, b.note, req.ip ?? null);
  }

  @Post("channel")
  @Roles(...TEAM)
  channel(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: AuthedRequest) {
    const b = parse(MarketingChannelRequest, body);
    return this.marketing.setChannel(u.id, b.channel, b.note, req.ip ?? null);
  }

  @Post("resume")
  @Roles(...TEAM)
  resume(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest) {
    return this.marketing.resume(u.id, req.ip ?? null);
  }

  /** Look for new events now (the job does it every half minute anyway). */
  @Post("detect")
  @Roles(...TEAM)
  async detect(): Promise<MarketingAdminDto> {
    await this.marketing.detect();
    return this.marketing.view();
  }

  /** Post the next queued item now (outside the window and gap, never past the daily limit). */
  @Post("publish-next")
  @Roles(...TEAM)
  @HttpCode(200)
  async publishNext(): Promise<MarketingAdminDto & { published: number }> {
    const published = await this.marketing.publish(true);
    return { ...(await this.marketing.view()), published };
  }

  @Post("items/:id/skip")
  @Roles(...TEAM)
  skip(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.marketing.skip(u.id, itemId(id));
  }

  @Get("items/:id/image")
  @Roles(...TEAM)
  async image(@Param("id") id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<Buffer> {
    const png = await this.marketing.preview(itemId(id));
    void reply.header("content-type", "image/png").header("cache-control", "private, max-age=300");
    return png;
  }
}
