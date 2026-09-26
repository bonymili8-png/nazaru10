import { Injectable } from "@nestjs/common";
import type { PassRewardDto, RacingPassDto, SilkPattern } from "@thoroughline/contracts";
import { seasonAt, seasonWindow } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { badRequest, conflict } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { silkItem } from "../cosmetics/cosmetics.service.js";
import { LedgerService } from "../economy/ledger.service.js";

type Track = "FREE" | "PREMIUM";

/**
 * Racing Pass. XP comes only from play (race runs, placings, training) and is recorded once per
 * source key; rewards are gems and cosmetic silks — never credits or anything that races faster,
 * so buying the premium track cannot buy an advantage.
 */
@Injectable()
export class PassService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  /** Award XP inside the caller's transaction; idempotent per key. */
  async addXp(c: Queryable, userId: string, key: string, xp: number, at: Date): Promise<void> {
    if (xp <= 0) return;
    const { season } = seasonAt(at, this.config.get());
    const r = await c.query(
      "INSERT INTO pass_xp_events (key, season, user_id, xp, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [key, season, userId, xp, at],
    );
    if (r.rowCount === 0) return;
    await c.query(
      `INSERT INTO pass_progress (season, user_id, xp, updated_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (season, user_id) DO UPDATE SET xp = pass_progress.xp + EXCLUDED.xp, updated_at = EXCLUDED.updated_at`,
      [season, userId, xp, at],
    );
  }

  /** XP for one settled race entry. */
  raceXp(position: number): number {
    const x = this.config.get().pass.xp;
    return x.raceRun + (position === 1 ? x.win : position === 2 ? x.second : position === 3 ? x.third : 0);
  }

  get trainingXp(): number {
    return this.config.get().pass.xp.training;
  }

  private reward(track: Track, tier: number): PassRewardDto | null {
    const p = this.config.get().pass;
    const r = (track === "FREE" ? p.free : p.premium)[String(tier)];
    return r
      ? { ...(r.gems ? { gems: r.gems } : {}), ...(r.silk ? { silk: r.silk as SilkPattern } : {}) }
      : null;
  }

  async view(userId: string): Promise<RacingPassDto> {
    const cfg = this.config.get();
    const now = this.clock.now();
    const { season } = seasonAt(now, cfg);
    const [progress, claims, balances] = await Promise.all([
      this.db.one<{ xp: number; premium_at: Date | null }>(
        "SELECT xp, premium_at FROM pass_progress WHERE season = $1 AND user_id = $2",
        [season, userId],
      ),
      this.db.query<{ tier: number; track: Track }>(
        "SELECT tier, track FROM pass_claims WHERE season = $1 AND user_id = $2",
        [season, userId],
      ),
      this.ledger.balances(userId),
    ]);
    const xp = progress?.xp ?? 0;
    const p = cfg.pass;
    const claimed = new Set(claims.map((c) => `${c.tier}:${c.track}`));
    return {
      season,
      endsAt: seasonWindow(season, cfg).endsAt.toISOString(),
      xp,
      tier: Math.min(p.tiers, Math.floor(xp / p.xpPerTier)),
      maxTier: p.tiers,
      xpPerTier: p.xpPerTier,
      premium: !!progress?.premium_at,
      premiumPriceGems: p.premiumPriceGems,
      gems: balances.GEMS,
      xpRules: p.xp,
      tiers: Array.from({ length: p.tiers }, (_, i) => {
        const tier = i + 1;
        return {
          tier,
          xpRequired: tier * p.xpPerTier,
          free: this.reward("FREE", tier),
          premium: this.reward("PREMIUM", tier),
          freeClaimed: claimed.has(`${tier}:FREE`),
          premiumClaimed: claimed.has(`${tier}:PREMIUM`),
        };
      }),
    };
  }

  async buyPremium(userId: string): Promise<RacingPassDto> {
    const cfg = this.config.get();
    const now = this.clock.now();
    const { season } = seasonAt(now, cfg);
    await this.db.tx(async (c) => {
      await c.query(
        "INSERT INTO pass_progress (season, user_id, xp, updated_at) VALUES ($1,$2,0,$3) ON CONFLICT DO NOTHING",
        [season, userId, now],
      );
      const p = await row<{ premium_at: Date | null }>(
        c,
        "SELECT premium_at FROM pass_progress WHERE season = $1 AND user_id = $2 FOR UPDATE",
        [season, userId],
      );
      if (p!.premium_at) throw conflict("ALREADY_PREMIUM", "You already have this season's premium pass");
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: cfg.pass.premiumPriceGems,
        sink: "RACING_PASS",
        key: `pass:${season}:${userId}:premium`,
        type: "RACING_PASS",
        reason: `Racing Pass — season ${season}`,
      });
      await c.query("UPDATE pass_progress SET premium_at = $3 WHERE season = $1 AND user_id = $2", [
        season,
        userId,
        now,
      ]);
      await this.events.emit(c, {
        type: "pass_premium",
        aggregateType: "user",
        aggregateId: userId,
        actorId: userId,
        payload: { season },
      });
    });
    return this.view(userId);
  }

  async claim(userId: string, tier: number, track: Track): Promise<RacingPassDto> {
    const cfg = this.config.get();
    const now = this.clock.now();
    const { season } = seasonAt(now, cfg);
    const reward = this.reward(track, tier);
    if (!reward || tier > cfg.pass.tiers) throw badRequest("NO_REWARD", "There is no reward on this tier");
    await this.db.tx(async (c) => {
      const p = await row<{ xp: number; premium_at: Date | null }>(
        c,
        "SELECT xp, premium_at FROM pass_progress WHERE season = $1 AND user_id = $2 FOR UPDATE",
        [season, userId],
      );
      if (!p || p.xp < tier * cfg.pass.xpPerTier) throw conflict("TIER_LOCKED", "Reach this tier first");
      if (track === "PREMIUM" && !p.premium_at)
        throw conflict("PREMIUM_REQUIRED", "Unlock the premium pass first");
      const ins = await c.query(
        "INSERT INTO pass_claims (season, user_id, tier, track, claimed_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [season, userId, tier, track, now],
      );
      if (ins.rowCount === 0) throw conflict("ALREADY_CLAIMED", "Reward already claimed");
      if (reward.gems) {
        await this.ledger.credit(c, {
          userId,
          currency: "GEMS",
          amount: reward.gems,
          source: "PASS_REWARDS",
          key: `pass:${season}:${userId}:${tier}:${track}`,
          type: "PASS_REWARD",
          reason: `Racing Pass tier ${tier}`,
        });
      }
      if (reward.silk) {
        await c.query(
          "INSERT INTO owned_cosmetics (user_id, item, acquired_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [userId, silkItem(reward.silk), now],
        );
      }
    });
    return this.view(userId);
  }
}
