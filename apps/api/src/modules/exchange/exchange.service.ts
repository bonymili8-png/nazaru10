import { Injectable } from "@nestjs/common";
import type {
  AdminGemExchangeDto,
  AdminGemExchangeToggle,
  GemExchangeDto,
  GemExchangeRequest,
  GemExchangeResultDto,
} from "@thoroughline/contracts";
import { gemExchangeBaseRate, gemExchangeOffers } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { badRequest, conflict } from "../../common/errors.js";
import { ConfigSwitchService } from "../../common/config-switch.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";

const DAY_MS = 86_400_000;
const SWITCH_PATH = ["economy", "gemExchange", "enabled"] as const;
const SWITCH_ACTION = "GEM_EXCHANGE_SWITCH";

/**
 * Buying credits with gems: fixed bundles, one way only (credits never turn back into gems),
 * capped per owner per UTC day. The admin switches it on and off; the switch is a config
 * version like any other, so it is audited and applied live.
 */
@Injectable()
export class ExchangeService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly config: GameConfigService,
    private readonly switches: ConfigSwitchService,
    private readonly clock: Clock,
  ) {}

  private dayStart(now: Date): Date {
    return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
  }

  private async boughtToday(c: Queryable, userId: string, now: Date): Promise<number> {
    const r = await row<{ n: number }>(
      c,
      "SELECT COALESCE(sum(credits), 0)::int AS n FROM gem_exchanges WHERE user_id = $1 AND created_at >= $2",
      [userId, this.dayStart(now)],
    );
    return r?.n ?? 0;
  }

  async offer(userId: string, c: Queryable = this.db.pool): Promise<GemExchangeDto> {
    const cfg = this.config.get();
    const x = cfg.economy.gemExchange;
    const now = this.clock.now();
    const today = await this.boughtToday(c, userId, now);
    return {
      enabled: x.enabled,
      baseRate: gemExchangeBaseRate(cfg),
      bundles: gemExchangeOffers(cfg),
      dailyCreditLimit: x.dailyCreditLimit,
      creditsToday: today,
      creditsLeft: Math.max(0, x.dailyCreditLimit - today),
      resetsAt: new Date(this.dayStart(now).getTime() + DAY_MS).toISOString(),
    };
  }

  async buy(userId: string, req: GemExchangeRequest): Promise<GemExchangeResultDto> {
    const replayed = await this.db.tx(async (c) => {
      // One exchange at a time per owner, so two taps cannot both slip under the daily cap.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('gem-exchange:' || $1))", [userId]);
      const done = await row(c, "SELECT 1 FROM gem_exchanges WHERE user_id = $1 AND request_id = $2", [
        userId,
        req.requestId,
      ]);
      if (done) return true;

      const cfg = this.config.get();
      const x = cfg.economy.gemExchange;
      if (!x.enabled)
        throw conflict("EXCHANGE_DISABLED", "Buying credits with gems is switched off right now");
      const bundle = x.bundles.find((b) => b.gems === req.gems);
      if (!bundle) throw badRequest("UNKNOWN_BUNDLE", "There is no such bundle");
      if (bundle.credits !== req.credits)
        throw conflict("BUNDLE_CHANGED", "This bundle has just changed — check the new amount", {
          credits: bundle.credits,
        });
      const now = this.clock.now();
      const left = x.dailyCreditLimit - (await this.boughtToday(c, userId, now));
      if (bundle.credits > left)
        throw conflict("DAILY_LIMIT", "That would pass today's limit on credits bought with gems", {
          creditsLeft: Math.max(0, left),
        });

      const r = await this.ledger.post(c, {
        idempotencyKey: `gem-exchange:${userId}:${req.requestId}`,
        type: "GEM_EXCHANGE",
        reason: `${bundle.gems} gems → ${bundle.credits} credits`,
        actorId: userId,
        metadata: { gems: bundle.gems, credits: bundle.credits },
        entries: [
          { account: { user: userId, currency: "GEMS" }, amount: -bundle.gems },
          { account: { system: "GEM_EXCHANGE", currency: "GEMS" }, amount: bundle.gems },
          { account: { system: "GEM_EXCHANGE", currency: "CREDITS" }, amount: -bundle.credits },
          { account: { user: userId, currency: "CREDITS" }, amount: bundle.credits },
        ],
      });
      await c.query(
        `INSERT INTO gem_exchanges (user_id, request_id, gems, credits, tx_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, req.requestId, bundle.gems, bundle.credits, r.txId, now],
      );
      return false;
    });
    return {
      exchange: await this.offer(userId),
      balances: await this.ledger.balances(userId),
      replayed,
    };
  }

  async adminView(): Promise<AdminGemExchangeDto> {
    const cfg = this.config.get();
    const now = this.clock.now().getTime();
    const since = { DAY: new Date(now - DAY_MS), WEEK: new Date(now - 7 * DAY_MS), ALL: new Date(0) };
    const stats = await Promise.all(
      (Object.keys(since) as (keyof typeof since)[]).map(async (period) => {
        const s = await this.db.one<{ exchanges: number; owners: number; gems: number; credits: number }>(
          `SELECT count(*)::int AS exchanges, count(DISTINCT user_id)::int AS owners,
                  COALESCE(sum(gems), 0)::int AS gems, COALESCE(sum(credits), 0)::int AS credits
             FROM gem_exchanges WHERE created_at >= $1`,
          [since[period]],
        );
        return { period, ...s! };
      }),
    );
    return {
      enabled: cfg.economy.gemExchange.enabled,
      dailyCreditLimit: cfg.economy.gemExchange.dailyCreditLimit,
      bundles: gemExchangeOffers(cfg),
      stats,
      history: await this.switches.history(SWITCH_ACTION),
    };
  }

  /** The admin's switch: a config version with only `economy.gemExchange.enabled` changed. */
  async setEnabled(
    actorId: string,
    req: AdminGemExchangeToggle,
    ip: string | null,
  ): Promise<AdminGemExchangeDto> {
    await this.switches.set(SWITCH_PATH, SWITCH_ACTION, {
      actorId,
      enabled: req.enabled,
      note: req.note || (req.enabled ? "Gem exchange switched on" : "Gem exchange switched off"),
      ip,
    });
    return this.adminView();
  }
}
