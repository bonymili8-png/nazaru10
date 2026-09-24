import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from "@nestjs/common";
import { FraudFlagsQuery, FraudReviewRequest } from "@thoroughline/contracts";
import { type AuthedRequest, type AuthUser, CurrentUser, Roles } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { FraudService } from "./fraud.service.js";

@Controller("admin/fraud")
@Roles("FRAUD_ANALYST")
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get("flags")
  flags(@Query() query: unknown) {
    const q = parse(FraudFlagsQuery, query);
    return this.fraud.list(q.status, q.limit);
  }

  @Post("flags/:id/review")
  review(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const b = parse(FraudReviewRequest, body);
    return this.fraud.review(actor.id, id, b.decision, b.note, req.ip);
  }
}
