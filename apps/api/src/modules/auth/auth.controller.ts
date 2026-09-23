import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { type AuthResponse, DevAuthRequest, TelegramAuthRequest } from "@thoroughline/contracts";
import { Public } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { RateLimit } from "../../common/rate-limit.js";
import { AuthService } from "./auth.service.js";

@Controller("auth")
@Public()
@RateLimit("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("telegram")
  @HttpCode(200)
  telegram(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.telegram(parse(TelegramAuthRequest, body).initData);
  }

  @Post("dev")
  @HttpCode(200)
  dev(@Body() body: unknown): Promise<AuthResponse> {
    return this.auth.dev(parse(DevAuthRequest, body));
  }
}
