import { Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { YardChoice, YardDto, YardEventDto } from "@thoroughline/contracts";
import { YARD_CHOICES } from "@thoroughline/engine";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { badRequest } from "../../common/errors.js";
import { YardService } from "./yard.service.js";

@Controller("yard")
export class YardController {
  constructor(private readonly yard: YardService) {}

  /** Open yard events and the last day's settled ones (creates any that are due). */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<YardDto> {
    return this.yard.list(user.id);
  }

  /** Answer an event: ACT (a call-out or rest) or WAIT (accept the risk). */
  @Post(":id/:choice")
  resolve(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("choice") choice: string,
  ): Promise<YardEventDto> {
    if (!(YARD_CHOICES as readonly string[]).includes(choice))
      throw badRequest("UNKNOWN_CHOICE", `Choices: ${YARD_CHOICES.join(", ")}`);
    return this.yard.resolve(user.id, id, choice as YardChoice);
  }
}
