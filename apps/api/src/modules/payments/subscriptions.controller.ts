import { Controller, Get, Post } from "@nestjs/common";
import type { SubscriptionDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@Controller("subscription")
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  view(@CurrentUser() user: AuthUser): Promise<SubscriptionDto> {
    return this.subs.view(user.id);
  }

  @Post("cancel")
  cancel(@CurrentUser() user: AuthUser): Promise<SubscriptionDto> {
    return this.subs.cancel(user.id);
  }

  @Post("resume")
  resume(@CurrentUser() user: AuthUser): Promise<SubscriptionDto> {
    return this.subs.resume(user.id);
  }
}
