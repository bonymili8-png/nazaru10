import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { FacilityParam, GearParam, RenameStableRequest, type StableDto } from "@thoroughline/contracts";
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

  @Post("facilities/:type")
  build(@CurrentUser() user: AuthUser, @Param("type") type: string): Promise<StableDto> {
    return this.stables.build(user.id, parse(FacilityParam, type));
  }

  @Post("gear/:item/repair")
  repairGear(@CurrentUser() user: AuthUser, @Param("item") item: string): Promise<StableDto> {
    return this.stables.repairGear(user.id, parse(GearParam, item));
  }

  @Post("gear/:item")
  buyGear(@CurrentUser() user: AuthUser, @Param("item") item: string): Promise<StableDto> {
    return this.stables.buyGear(user.id, parse(GearParam, item));
  }

  /** Rename the stable for gems (Latin letters only). */
  @Post("rename")
  rename(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<StableDto> {
    return this.stables.rename(user.id, parse(RenameStableRequest, body).name);
  }
}
