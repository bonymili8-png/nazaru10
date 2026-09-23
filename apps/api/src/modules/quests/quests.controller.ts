import { Controller, Get, Param, Post } from "@nestjs/common";
import type { QuestDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { QuestsService } from "./quests.service.js";

@Controller("quests")
export class QuestsController {
  constructor(
    private readonly quests: QuestsService,
    private readonly clock: Clock,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<QuestDto[]> {
    return this.quests.list(user.id);
  }

  @Post(":code/claim")
  claim(@CurrentUser() user: AuthUser, @Param("code") code: string): Promise<QuestDto[]> {
    return this.quests.claim(user.id, code.slice(0, 40), this.clock.now());
  }
}
