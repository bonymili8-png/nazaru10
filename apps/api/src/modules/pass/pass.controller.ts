import { Body, Controller, Get, Post } from "@nestjs/common";
import { PassClaimRequest, type RacingPassDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { PassService } from "./pass.service.js";

@Controller("pass")
export class PassController {
  constructor(private readonly pass: PassService) {}

  @Get()
  view(@CurrentUser() user: AuthUser): Promise<RacingPassDto> {
    return this.pass.view(user.id);
  }

  @Post("premium")
  buyPremium(@CurrentUser() user: AuthUser): Promise<RacingPassDto> {
    return this.pass.buyPremium(user.id);
  }

  @Post("claim")
  claim(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<RacingPassDto> {
    const b = parse(PassClaimRequest, body);
    return this.pass.claim(user.id, b.tier, b.track);
  }
}
