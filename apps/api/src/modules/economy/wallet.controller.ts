import { Controller, Get, Query } from "@nestjs/common";
import { CursorQuery, type LedgerLineDto, type WalletDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { LedgerService } from "./ledger.service.js";

@Controller("wallet")
export class WalletController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  async wallet(@CurrentUser() user: AuthUser): Promise<WalletDto> {
    return { balances: await this.ledger.balances(user.id) };
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
