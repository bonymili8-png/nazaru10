import { Injectable } from "@nestjs/common";
import type {
  AdminGemExchangeDto,
  AdminGemExchangeToggle,
  GemExchangeDto,
  GemExchangeRequest,
  GemExchangeResultDto,
} from "@thoroughline/contracts";
import { defaultConfig, gemExchangeBaseRate, gemExchangeOffers } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { badRequest, conflict } from "../../common/errors.js";
import { AuditService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";

const DAY_MS = 86_400_000;

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
    private readonly audit: AuditService,
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
    const history = await this.db.query<{
      after: { enabled: boolean };
      created_at: Date;
      by: string | null;
      reason: string | null;
    }>(
      `SELECT a.after, a.created_at, a.reason, COALESCE(u.username, u.first_name) AS by
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.action = 'GEM_EXCHANGE_SWITCH' ORDER BY a.id DESC LIMIT 10`,
    );
    return {
      enabled: cfg.economy.gemExchange.enabled,
      dailyCreditLimit: cfg.economy.gemExchange.dailyCreditLimit,
      bundles: gemExchangeOffers(cfg),
      stats,
      history: history.map((h) => ({
        enabled: !!h.after?.enabled,
        at: h.created_at.toISOString(),
        by: h.by,
        note: h.reason,
      })),
    };
  }

  /** The admin's switch: publishes a config version with only `enabled` changed. */
  async setEnabled(
    actorId: string,
    req: AdminGemExchangeToggle,
    ip: string | null,
  ): Promise<AdminGemExchangeDto> {
    const changed = await this.db.tx(async (c) => {
      const prev = await row<{ config: Record<string, unknown> | null }>(
        c,
        "SELECT config FROM game_config ORDER BY version DESC LIMIT 1 FOR UPDATE",
      );
      const override = structuredClone(prev?.config ?? {}) as {
        economy?: { gemExchange?: Record<string, unknown> } & Record<string, unknown>;
      } & Record<string, unknown>;
      const current =
        (override.economy?.gemExchange?.enabled as boolean | undefined) ??
        defaultConfig.economy.gemExchange.enabled;
      if (current === req.enabled) return false;
      override.economy = {
        ...override.economy,
        gemExchange: { ...override.economy?.gemExchange, enabled: req.enabled },
      };
      const note = req.note || (req.enabled ? "Gem exchange switched on" : "Gem exchange switched off");
      const r = await rows<{ version: number }>(
        c,
        "INSERT INTO game_config (config, created_by, note) VALUES ($1, $2, $3) RETURNING version",
        [JSON.stringify(override), actorId, note],
      );
      await this.audit.log(c, {
        actorId,
        action: "GEM_EXCHANGE_SWITCH",
        targetType: "game_config",
        targetId: String(r[0]!.version),
        before: { enabled: current },
        after: { enabled: req.enabled },
        reason: note,
        ip,
      });
      return true;
    });
    if (changed) await this.config.refresh();
    return this.adminView();
  }
}
