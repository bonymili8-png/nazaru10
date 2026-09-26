import { Inject, Injectable } from "@nestjs/common";
import type { AuthResponse, DevAuthRequest, UserDto } from "@thoroughline/contracts";
import { type Role, TokenService } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { AppError, forbidden, unauthorized } from "../../common/errors.js";
import { ENV, type Env } from "../../config/env.js";
import { OnboardingService, type TelegramProfile, type UserRow } from "../users/onboarding.service.js";
import { createHmac } from "node:crypto";
import { InitDataError, verifyInitData } from "./telegram-init-data.js";

export const ipHash = (ip: string, secret: string) =>
  createHmac("sha256", secret).update(`ip:${ip}`).digest("hex").slice(0, 32);

export const toUserDto = (u: UserRow): UserDto => ({
  id: u.id,
  firstName: u.first_name,
  username: u.username,
  role: u.role,
  referralCode: u.referral_code,
  createdAt: u.created_at.toISOString(),
  settings: {
    locale: u.settings.locale === "en" || u.settings.locale === "uk" ? u.settings.locale : null,
    notifications: u.settings.notifications !== false,
  },
});

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly onboarding: OnboardingService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async telegram(initData: string, ip: string | null = null): Promise<AuthResponse> {
    const now = this.clock.now();
    let verified;
    try {
      verified = verifyInitData(
        initData,
        this.env.TELEGRAM_BOT_TOKEN,
        this.env.TELEGRAM_AUTH_MAX_AGE_SEC,
        now,
      );
    } catch (err) {
      if (err instanceof InitDataError) throw unauthorized(`Telegram authentication failed (${err.reason})`);
      throw err;
    }
    const u = verified.user;
    return this.login(
      {
        telegramId: u.id,
        firstName: u.first_name ?? null,
        lastName: u.last_name ?? null,
        username: u.username ?? null,
        languageCode: u.language_code ?? null,
        isPremium: !!u.is_premium,
        photoUrl: u.photo_url ?? null,
      },
      verified.startParam,
      ip,
    );
  }

  /** Local development only: guarded by config, and config refuses it in production. */
  async dev(req: DevAuthRequest, ip: string | null = null): Promise<AuthResponse> {
    if (!this.env.ALLOW_DEV_AUTH || this.env.NODE_ENV === "production")
      throw new AppError(404, "NOT_FOUND", "Not found");
    return this.login(
      {
        telegramId: req.telegramId,
        firstName: req.firstName,
        lastName: null,
        username: req.username ?? null,
        languageCode: "en",
        isPremium: false,
        photoUrl: null,
      },
      req.startParam ?? null,
      ip,
    );
  }

  private async login(
    profile: TelegramProfile,
    startParam: string | null,
    ip: string | null,
  ): Promise<AuthResponse> {
    const now = this.clock.now();
    const { user, isNew } = await this.db.tx(async (c) => {
      const r = await this.onboarding.upsert(c, profile, startParam, now);
      // Anti-fraud clustering: a keyed hash of the client IP, never the address itself.
      if (ip)
        await c.query(
          `INSERT INTO login_ips (user_id, ip_hash, first_seen, last_seen) VALUES ($1, $2, $3, $3)
           ON CONFLICT (user_id, ip_hash) DO UPDATE SET last_seen = EXCLUDED.last_seen`,
          [r.user.id, ipHash(ip, this.env.JWT_SECRET), now],
        );
      return r;
    });
    if (user.status === "SUSPENDED") throw forbidden("Account suspended");
    if (user.status === "DELETED") throw unauthorized();
    const { token, expiresAt } = await this.tokens.issue({ id: user.id, role: user.role as Role }, now);
    return { token, expiresAt: expiresAt.toISOString(), user: toUserDto(user), isNew };
  }
}
