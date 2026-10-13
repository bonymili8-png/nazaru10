import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import { type CampaignDto, CampaignPeriodQuery, CreateCampaignRequest } from "@thoroughline/contracts";
import { type AuthedRequest, type AuthUser, CurrentUser, Public, Roles } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { CampaignsService } from "./campaigns.service.js";

const MARKETING = ["ECONOMY_ADMIN", "FINANCE_ADMIN", "CONTENT_ADMIN"] as const;

/** Campaign links and their funnels (admin console, "campaigns" tab). */
@Controller("admin/campaigns")
export class CampaignsAdminController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @Roles(...MARKETING)
  list(@Query() query: unknown): Promise<CampaignDto[]> {
    return this.campaigns.list(parse(CampaignPeriodQuery, query));
  }

  @Post()
  @Roles(...MARKETING)
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<CampaignDto> {
    return this.campaigns.create(user.id, parse(CreateCampaignRequest, body), req.ip ?? null);
  }

  @Post(":id/archive")
  @Roles(...MARKETING)
  archive(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<CampaignDto> {
    return this.campaigns.setArchived(user.id, id, true, req.ip ?? null);
  }

  @Post(":id/restore")
  @Roles(...MARKETING)
  restore(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
  ): Promise<CampaignDto> {
    return this.campaigns.setArchived(user.id, id, false, req.ip ?? null);
  }
}

/** The tracked link's landing page reports a visit here, then opens the Mini App. */
@Public()
@Controller("public/campaigns")
export class CampaignsPublicController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post(":code/click")
  async click(
    @Param("code") code: string,
    @Req() req: AuthedRequest,
  ): Promise<{ startParam: string | null }> {
    const ua = (req.headers["user-agent"] as string | undefined) ?? null;
    const r = await this.campaigns.click(code, req.ip ?? null, ua);
    return { startParam: r?.startParam ?? null };
  }
}
