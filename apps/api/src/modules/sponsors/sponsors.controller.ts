import { Controller, Get, Param, Post } from "@nestjs/common";
import type { SponsorsDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { SponsorsService } from "./sponsors.service.js";

@Controller("sponsors")
export class SponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}

  @Get()
  view(@CurrentUser() user: AuthUser): Promise<SponsorsDto> {
    return this.sponsors.view(user.id);
  }

  @Post(":code/sign")
  sign(@CurrentUser() user: AuthUser, @Param("code") code: string): Promise<SponsorsDto> {
    return this.sponsors.sign(user.id, code.slice(0, 40));
  }
}
