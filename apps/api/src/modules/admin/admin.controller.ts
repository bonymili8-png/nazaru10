import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { AdminAdjustRequest, AdminCreateRaceRequest, AdminReasonRequest } from "@thoroughline/contracts";
import { type AuthedRequest, type AuthUser, CurrentUser, Roles } from "../../common/auth.js";
import { Db } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { AuditService } from "../../common/events.js";
import { parse } from "../../common/http.js";
import { LedgerService } from "../economy/ledger.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import { RaceRunnerService } from "../races/race-runner.service.js";

/** Internal operations. Every mutation is RBAC-protected and written to the append-only audit log. */
@Controller("admin")
export class AdminController {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly runner: RaceRunnerService,
  ) {}

  @Get("users/:id")
  @Roles("SUPPORT_ADMIN", "FINANCE_ADMIN", "ECONOMY_ADMIN", "FRAUD_ANALYST")
  async user(@Param("id", ParseUUIDPipe) id: string) {
    const u = await this.db.one(
      "SELECT id, telegram_id, username, first_name, role, status, trust_score, referred_by, created_at, last_seen_at FROM users WHERE id = $1",
      [id],
    );
    if (!u) throw notFound("User");
    const [balances, ledger, payments] = await Promise.all([
      this.ledger.balances(id),
      this.ledger.history(id, 50),
      this.db.query(
        "SELECT id, product_id, amount, currency, status, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
        [id],
      ),
    ]);
    return { user: u, balances, ledger, payments };
  }

  @Post("users/:id/adjust")
  @Roles("ECONOMY_ADMIN")
  async adjust(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const b = parse(AdminAdjustRequest, body);
    const key = `admin:adjust:${actor.id}:${id}:${Date.now()}`;
    await this.db.tx(async (c) => {
      const before = await this.ledger.balances(id, c);
      const common = {
        userId: id,
        currency: b.currency,
        amount: Math.abs(b.amount),
        key,
        type: "ADMIN_ADJUSTMENT",
        reason: b.reason,
        actorId: actor.id,
      } as const;
      if (b.amount > 0) await this.ledger.credit(c, { ...common, source: "ADMIN_ADJUSTMENT" });
      else await this.ledger.debit(c, { ...common, sink: "ADMIN_ADJUSTMENT" });
      await this.audit.log(c, {
        actorId: actor.id,
        action: "BALANCE_ADJUST",
        targetType: "user",
        targetId: id,
        before,
        after: { currency: b.currency, amount: b.amount },
        reason: b.reason,
        ip: req.ip,
      });
    });
    return { balances: await this.ledger.balances(id) };
  }

  @Post("users/:id/suspend")
  @Roles("SUPPORT_ADMIN", "FRAUD_ANALYST")
  async suspend(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return this.setStatus(actor, id, "SUSPENDED", parse(AdminReasonRequest, body).reason, req.ip);
  }

  @Post("users/:id/reinstate")
  @Roles("SUPPORT_ADMIN")
  async reinstate(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    return this.setStatus(actor, id, "ACTIVE", parse(AdminReasonRequest, body).reason, req.ip);
  }

  private async setStatus(
    actor: AuthUser,
    id: string,
    status: "ACTIVE" | "SUSPENDED",
    reason: string,
    ip: string,
  ) {
    if (actor.id === id) throw conflict("SELF_ACTION", "You cannot change your own status");
    await this.db.tx(async (c) => {
      const r = await c.query<{ status: string }>("SELECT status FROM users WHERE id = $1 FOR UPDATE", [id]);
      if (!r.rows[0]) throw notFound("User");
      await c.query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
      await this.audit.log(c, {
        actorId: actor.id,
        action: `USER_${status}`,
        targetType: "user",
        targetId: id,
        before: r.rows[0],
        after: { status },
        reason,
        ip,
      });
    });
    return { id, status };
  }

  @Post("payments/:id/refund")
  @Roles("FINANCE_ADMIN")
  refund(@CurrentUser() actor: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.payments.refund(actor.id, id, parse(AdminReasonRequest, body).reason);
  }

  @Post("races")
  @Roles("GAME_ADMIN", "TOURNAMENT_ADMIN")
  async createRace(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    const b = parse(AdminCreateRaceRequest, body);
    const id = await this.runner.createSpecial(actor.id, {
      name: b.name,
      cls: b.class,
      trackCode: b.trackCode,
      distance: b.distance,
      startsAt: new Date(b.startsAt),
      purse: b.purse,
      entryFee: b.entryFee,
    });
    return { id };
  }

  @Post("races/:id/cancel")
  @Roles("GAME_ADMIN", "TOURNAMENT_ADMIN")
  async cancelRace(
    @CurrentUser() actor: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    await this.runner.cancel(id, parse(AdminReasonRequest, body).reason, actor.id);
    return { id, status: "CANCELLED" };
  }

  /** Economy dashboard core: cumulative mint (sources) and burn (sinks) per reason and currency. */
  @Get("economy")
  @Roles("ECONOMY_ADMIN", "FINANCE_ADMIN")
  async economy() {
    const system = await this.db.query<{ code: string; currency: string; balance: number }>(
      "SELECT code, currency, balance FROM accounts WHERE owner_type = 'SYSTEM' ORDER BY currency, code",
    );
    const supply = await this.db.query<{
      currency: string;
      circulating: number;
      holders: number;
      p50: number;
      p90: number;
    }>(
      `SELECT currency, sum(balance)::bigint AS circulating, count(*)::int AS holders,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY balance)::bigint AS p50,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY balance)::bigint AS p90
         FROM accounts WHERE owner_type = 'USER' GROUP BY currency ORDER BY currency`,
    );
    const daily = await this.db.query<{ day: string; currency: string; minted: number; burned: number }>(
      `SELECT to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') AS day, a.currency,
              COALESCE(sum(-e.amount) FILTER (WHERE e.amount < 0), 0)::bigint AS minted,
              COALESCE(sum(e.amount) FILTER (WHERE e.amount > 0), 0)::bigint AS burned
         FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE a.owner_type = 'SYSTEM' AND e.created_at > now() - interval '14 days'
        GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
    );
    return {
      // System balance < 0 ⇒ net source (minted into the economy); > 0 ⇒ net sink (burned).
      byReason: system.map((s) => ({ ...s, net: -s.balance })),
      supply,
      daily,
    };
  }
}
