import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
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
  telegram(@Body() body: unknown, @Req() req: FastifyRequest): Promise<AuthResponse> {
    return this.auth.telegram(parse(TelegramAuthRequest, body).initData, req.ip);
  }

  @Post("dev")
  @HttpCode(200)
  dev(@Body() body: unknown, @Req() req: FastifyRequest): Promise<AuthResponse> {
    return this.auth.dev(parse(DevAuthRequest, body), req.ip);
  }
}
