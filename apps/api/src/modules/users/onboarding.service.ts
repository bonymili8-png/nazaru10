import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { row } from "../../common/db.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { HorseFactory } from "../horses/horse.factory.js";
import { recordOwnership } from "../horses/horse.repo.js";
import { QuestsService } from "../quests/quests.service.js";

export interface TelegramProfile {
  telegramId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  isPremium: boolean;
  photoUrl: string | null;
}

export interface UserRow {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: string;
  status: string;
  referral_code: string;
  created_at: Date;
}

const referralCode = () =>
  randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8).toUpperCase();

const stableName = (first: string | null) => {
  const clean = (first ?? "")
    .replace(/[^\p{L}\p{N} '&.-]/gu, "")
    .trim()
    .slice(0, 28);
  return clean.length >= 2 ? `${clean}'s Stable` : "New Stable";
};

/** Creates or refreshes a user from a verified Telegram identity; bootstraps new players. */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly factory: HorseFactory,
    private readonly quests: QuestsService,
    private readonly events: EventsService,
  ) {}

  async upsert(
    c: PoolClient,
    p: TelegramProfile,
    startParam: string | null,
    now: Date,
  ): Promise<{ user: UserRow; isNew: boolean }> {
    // Retry on the (astronomically unlikely) referral-code collision.
    for (let attempt = 0; ; attempt++) {
      try {
        await c.query("SAVEPOINT upsert_user");
        const r = await row<UserRow & { inserted: boolean }>(
          c,
          `INSERT INTO users (telegram_id, username, first_name, last_name, language_code, is_premium, photo_url, referral_code, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name, language_code = EXCLUDED.language_code, is_premium = EXCLUDED.is_premium,
             photo_url = EXCLUDED.photo_url, last_seen_at = EXCLUDED.last_seen_at, updated_at = EXCLUDED.last_seen_at
           RETURNING id, telegram_id, username, first_name, role, status, referral_code, created_at, (xmax = 0) AS inserted`,
          [
            p.telegramId,
            p.username,
            p.firstName,
            p.lastName,
            p.languageCode,
            p.isPremium,
            p.photoUrl,
            referralCode(),
            now,
          ],
        );
        await c.query("RELEASE SAVEPOINT upsert_user");
        const { inserted, ...user } = r!;
        if (inserted) await this.bootstrap(c, user, p, startParam, now);
        return { user, isNew: inserted };
      } catch (err) {
        await c.query("ROLLBACK TO SAVEPOINT upsert_user");
        const e = err as { code?: string; constraint?: string };
        if (e.code === "23505" && e.constraint === "users_referral_code_key" && attempt < 3) continue;
        throw err;
      }
    }
  }

  private async bootstrap(
    c: PoolClient,
    user: UserRow,
    p: TelegramProfile,
    startParam: string | null,
    now: Date,
  ) {
    const cfg = this.config.get();
    if (startParam?.startsWith("ref_")) {
      const code = startParam.slice(4, 20).toUpperCase();
      await c.query(
        "UPDATE users SET referred_by = (SELECT id FROM users WHERE referral_code = $2 AND id <> $1 AND status = 'ACTIVE') WHERE id = $1",
        [user.id, code],
      );
    }
    const stable = await row<{ id: string }>(
      c,
      "INSERT INTO stables (owner_id, name) VALUES ($1, $2) RETURNING id",
      [user.id, stableName(p.firstName)],
    );
    await this.ledger.credit(c, {
      userId: user.id,
      currency: "CREDITS",
      amount: cfg.economy.startingCredits,
      source: "STARTER_GRANT",
      key: `onboarding:grant:${user.id}`,
      type: "STARTER_GRANT",
      reason: "Welcome to the track",
    });
    const horse = await this.factory.generate(c, {
      quality: 0.42,
      age: 2.3,
      rarity: "UNCOMMON",
      ownerId: user.id,
      stableId: stable!.id,
      isHouse: false,
      now,
    });
    await recordOwnership(c, horse.id, null, user.id, "STARTER");
    await this.quests.complete(c, user.id, "CREATE_STABLE", now);
    await this.quests.complete(c, user.id, "FIRST_HORSE", now);
    await this.events.emit(c, {
      type: "user_registered",
      aggregateType: "user",
      aggregateId: user.id,
      actorId: user.id,
      payload: { startParam, starterHorseId: horse.id },
    });
  }
}
