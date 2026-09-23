import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { RenameStableRequest, type StableDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { StableService } from "./stable.service.js";

@Controller("stable")
export class StableController {
  constructor(private readonly stables: StableService) {}

  @Get()
  view(@CurrentUser() user: AuthUser): Promise<StableDto> {
    return this.stables.view(user.id);
  }

  @Post("upgrade")
  upgrade(@CurrentUser() user: AuthUser): Promise<StableDto> {
    return this.stables.upgrade(user.id);
  }

  @Patch()
  rename(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<StableDto> {
    return this.stables.rename(user.id, parse(RenameStableRequest, body).name);
  }
}
