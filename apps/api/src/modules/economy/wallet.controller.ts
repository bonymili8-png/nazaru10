import { Controller, Get, Post, Query } from "@nestjs/common";
import { CursorQuery, type LedgerLineDto, type WalletDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { conflict } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "./ledger.service.js";

@Controller("wallet")
export class WalletController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
  ) {}

  private allowanceKey(userId: string): string {
    return `allowance:${userId}:${this.clock.now().toISOString().slice(0, 10)}`;
  }

  @Get()
  async wallet(@CurrentUser() user: AuthUser): Promise<WalletDto> {
    const balances = await this.ledger.balances(user.id);
    const a = this.config.get().economy.allowance;
    const claimed = await this.db.one("SELECT 1 FROM ledger_transactions WHERE idempotency_key = $1", [
      this.allowanceKey(user.id),
    ]);
    return {
      balances,
      allowance: {
        amount: a.amount,
        threshold: a.threshold,
        eligible: !claimed && balances.CREDITS < a.threshold,
      },
    };
  }

  /** Safety net against soft-lock: once per UTC day, an owner below the threshold may claim a small allowance. */
  @Post("allowance")
  async claimAllowance(@CurrentUser() user: AuthUser): Promise<WalletDto> {
    const a = this.config.get().economy.allowance;
    await this.db.tx(async (c) => {
      const credits = (await this.ledger.balances(user.id, c)).CREDITS;
      if (credits >= a.threshold)
        throw conflict("NOT_ELIGIBLE", `The allowance is for owners with under ${a.threshold} credits`);
      const r = await this.ledger.credit(c, {
        userId: user.id,
        currency: "CREDITS",
        amount: a.amount,
        source: "DAILY_ALLOWANCE",
        key: this.allowanceKey(user.id),
        type: "DAILY_ALLOWANCE",
        reason: "Stable allowance",
      });
      if (r.replayed) throw conflict("ALREADY_CLAIMED", "Today's allowance has already been claimed");
    });
    return this.wallet(user);
  }

  @Get("transactions")
  async transactions(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
  ): Promise<{ items: LedgerLineDto[]; nextCursor: number | null }> {
    const q = parse(CursorQuery, query);
    const items = (await this.ledger.history(user.id, q.limit, q.cursor)).map((r) => ({
      id: r.id,
      currency: r.currency,
      amount: r.amount,
      balanceAfter: r.balance_after,
      type: r.type,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
    }));
    return { items, nextCursor: items.length === q.limit ? items[items.length - 1]!.id : null };
  }
}
