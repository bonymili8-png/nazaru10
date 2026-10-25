import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import { type SocialAdminDto, SocialPlatformParam, SocialSwitchRequest } from "@thoroughline/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type AuthedRequest, type AuthUser, CurrentUser, Public, Roles } from "../../common/auth.js";
import { badRequest, notFound } from "../../common/errors.js";
import { parse } from "../../common/http.js";
import type { OAuthProvider } from "./social-api.js";
import { SocialService } from "./social.service.js";

const TEAM = ["CONTENT_ADMIN", "ECONOMY_ADMIN"] as const;

/** Admin console → marketing → other networks. */
@Controller("admin/marketing")
export class SocialAdminController {
  constructor(private readonly social: SocialService) {}

  @Get("social")
  @Roles(...TEAM)
  view(): Promise<SocialAdminDto> {
    return this.social.view();
  }

  @Post("social/switch")
  @Roles(...TEAM)
  switch(@CurrentUser() u: AuthUser, @Body() body: unknown, @Req() req: AuthedRequest) {
    const b = parse(SocialSwitchRequest, body);
    return this.social.setSwitch(u.id, b.key, b.enabled, b.note, req.ip ?? null);
  }

  /** The network's sign-in address; the console opens it in the browser. */
  @Post("social/:platform/connect")
  @Roles(...TEAM)
  @HttpCode(200)
  connect(@CurrentUser() u: AuthUser, @Param("platform") platform: string) {
    return this.social.connectUrl(u.id, parse(SocialPlatformParam, platform));
  }

  @Post("social/:platform/disconnect")
  @Roles(...TEAM)
  @HttpCode(200)
  disconnect(@CurrentUser() u: AuthUser, @Param("platform") platform: string, @Req() req: AuthedRequest) {
    return this.social.disconnect(u.id, parse(SocialPlatformParam, platform), req.ip ?? null);
  }

  @Post("social/:platform/check")
  @Roles(...TEAM)
  @HttpCode(200)
  check(@Param("platform") platform: string) {
    return this.social.check(parse(SocialPlatformParam, platform));
  }

  @Post("social/:platform/resume")
  @Roles(...TEAM)
  @HttpCode(200)
  resume(@CurrentUser() u: AuthUser, @Param("platform") platform: string, @Req() req: AuthedRequest) {
    return this.social.resume(u.id, parse(SocialPlatformParam, platform), req.ip ?? null);
  }

  /** Post the next waiting item there now (outside the window and gap, never past the daily limit). */
  @Post("social/:platform/publish-next")
  @Roles(...TEAM)
  @HttpCode(200)
  async publishNext(@Param("platform") platform: string): Promise<SocialAdminDto & { published: number }> {
    const published = (await this.social.publishOn(parse(SocialPlatformParam, platform), true)) ? 1 : 0;
    return { ...(await this.social.view()), published };
  }

  /** Make (if needed) and show a post's race video. */
  @Post("items/:id/video")
  @Roles(...TEAM)
  @HttpCode(200)
  video(@Param("id") id: string) {
    if (!/^\d{1,18}$/.test(id)) throw badRequest("BAD_ID", "Not a post id");
    return this.social.previewVideo(id);
  }
}

const PROVIDERS: Record<string, OAuthProvider> = { google: "GOOGLE", meta: "META", threads: "THREADS" };

/**
 * Public ends of the networks' flows: the address their sign-in returns to (the signed `state`
 * names the admin who started it), and the media they fetch to post (videos, JPEG cards).
 */
@Public()
@Controller()
export class SocialPublicController {
  constructor(private readonly social: SocialService) {}

  @Get("marketing/oauth/:provider/callback")
  async callback(
    @Param("provider") provider: string,
    @Query() q: Record<string, string>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const p = PROVIDERS[provider];
    if (!p) throw notFound("Sign-in");
    const r = await this.social.callback(p, q);
    void reply.status(r.ok ? 200 : 400).header("content-type", "text/html; charset=utf-8");
    return r.html;
  }

  @Get("public/media/:file")
  async media(
    @Param("file") file: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const m = /^([0-9a-f-]{36})\.(mp4|jpg|png)$/.exec(file);
    if (!m) throw notFound("Media");
    const f = await this.social.mediaFile(m[1]!);
    if (!f) throw notFound("Media");
    void reply
      .header("content-type", f.mime)
      .header("cache-control", "public, max-age=86400")
      .header("accept-ranges", "bytes");
    // Video fetchers may ask for byte ranges.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      const size = f.bytes.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start >= size || start > end) {
        void reply.status(416).header("content-range", `bytes */${size}`);
        return Buffer.alloc(0);
      }
      void reply.status(206).header("content-range", `bytes ${start}-${end}/${size}`);
      return f.bytes.subarray(start, end + 1);
    }
    return f.bytes;
  }
}
