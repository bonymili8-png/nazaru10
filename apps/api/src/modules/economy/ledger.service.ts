import { Injectable } from "@nestjs/common";
import type { Currency } from "@thoroughline/contracts";
import { Db, type Queryable, rows } from "../../common/db.js";
import { badRequest, conflict } from "../../common/errors.js";

export const CURRENCIES: readonly Currency[] = ["CREDITS", "GEMS", "REPUTATION", "PRESTIGE"];

/** System account codes = named sources (mint) and sinks (burn) — the economy dashboard axes. */
export type SystemAccount =
  | "STARTER_GRANT"
  | "QUEST_REWARD"
  | "REFERRAL_REWARD"
  | "RACE_PRIZE"
  | "RACE_ENTRY"
  | "RACE_REFUND"
  | "TRAINING"
  | "VET"
  | "STABLE_UPGRADE"
  | "HORSE_SALES"
  | "DIAGNOSTICS"
  | "PAYMENTS"
  | "ADMIN_ADJUSTMENT"
  | "MARKET_FEES"
  | "STUD_FEES";

/** Non-negative holding accounts (money in flight, e.g. auction bids). */
export type EscrowAccount = "MARKET";

export type AccountRef =
  | { user: string; currency: Currency }
  | { system: SystemAccount; currency: Currency }
  | { escrow: EscrowAccount; currency: Currency };

export interface Posting {
  idempotencyKey: string;
  type: string;
  reason?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
  entries: { account: AccountRef; amount: number }[];
}

export interface PostResult {
  txId: number | null;
  replayed: boolean;
}

const refKey = (r: AccountRef) =>
  "user" in r
    ? `U:${r.user}:${r.currency}`
    : "system" in r
      ? `S:${r.system}:${r.currency}`
      : `E:${r.escrow}:${r.currency}`;

/**
 * The only writer of balances. Every change is a balanced double-entry transaction with a
 * unique idempotency key; user balances can never go negative (checked here and by the DB).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: Db) {}

  async post(c: Queryable, p: Posting): Promise<PostResult> {
    if (p.entries.length < 2) throw badRequest("LEDGER_INVALID", "a transaction needs at least two entries");
    const sums = new Map<Currency, number>();
    for (const e of p.entries) {
      if (!Number.isSafeInteger(e.amount) || e.amount === 0)
        throw badRequest("LEDGER_INVALID", "amounts must be non-zero integers");
      sums.set(e.account.currency, (sums.get(e.account.currency) ?? 0) + e.amount);
    }
    for (const [cur, s] of sums)
      if (s !== 0) throw badRequest("LEDGER_INVALID", `unbalanced ${cur} transaction`);

    const existing = await c.query<{ id: number }>(
      "SELECT id FROM ledger_transactions WHERE idempotency_key = $1",
      [p.idempotencyKey],
    );
    if (existing.rows[0]) return { txId: existing.rows[0].id, replayed: true };

    // Resolve (create if missing) accounts, then lock them in id order to avoid deadlocks.
    const ids = new Map<string, number>();
    for (const e of p.entries) {
      const k = refKey(e.account);
      if (!ids.has(k)) ids.set(k, await this.ensureAccount(c, e.account));
    }
    const locked = await rows<{ id: number; owner_type: string; balance: number }>(
      c,
      "SELECT id, owner_type, balance FROM accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [[...ids.values()]],
    );

    const inserted = await c.query<{ id: number }>(
      `INSERT INTO ledger_transactions (idempotency_key, type, reason, actor_id, metadata)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [p.idempotencyKey, p.type, p.reason ?? null, p.actorId ?? null, JSON.stringify(p.metadata ?? {})],
    );
    // A concurrent request with the same key committed first while we waited for the locks.
    if (!inserted.rows[0]) return { txId: null, replayed: true };
    const txId = inserted.rows[0].id;

    const balances = new Map(locked.map((a) => [a.id, a.balance] as const));
    const kinds = new Map(locked.map((a) => [a.id, a.owner_type] as const));
    const lines: [number, number, number][] = [];
    for (const e of p.entries) {
      const id = ids.get(refKey(e.account))!;
      const next = balances.get(id)! + e.amount;
      if (kinds.get(id) !== "SYSTEM" && next < 0) {
        throw conflict("INSUFFICIENT_FUNDS", `Not enough ${e.account.currency}`, {
          currency: e.account.currency,
        });
      }
      balances.set(id, next);
      lines.push([id, e.amount, next]);
    }
    await c.query(
      `INSERT INTO ledger_entries (tx_id, account_id, amount, balance_after)
       SELECT $1, a, b, n FROM unnest($2::bigint[], $3::bigint[], $4::bigint[]) AS t(a, b, n)`,
      [txId, lines.map((l) => l[0]), lines.map((l) => l[1]), lines.map((l) => l[2])],
    );
    for (const [id, bal] of balances)
      await c.query("UPDATE accounts SET balance = $2 WHERE id = $1", [id, bal]);
    return { txId, replayed: false };
  }

  /** Mint from a system source into a user's wallet. */
  credit(
    c: Queryable,
    a: {
      userId: string;
      currency: Currency;
      amount: number;
      source: SystemAccount;
      key: string;
      type: string;
      reason?: string;
      actorId?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<PostResult> {
    return this.post(c, {
      idempotencyKey: a.key,
      type: a.type,
      reason: a.reason,
      actorId: a.actorId,
      metadata: a.metadata,
      entries: [
        { account: { system: a.source, currency: a.currency }, amount: -a.amount },
        { account: { user: a.userId, currency: a.currency }, amount: a.amount },
      ],
    });
  }

  /** Burn from a user's wallet into a system sink. Throws INSUFFICIENT_FUNDS. */
  debit(
    c: Queryable,
    a: {
      userId: string;
      currency: Currency;
      amount: number;
      sink: SystemAccount;
      key: string;
      type: string;
      reason?: string;
      actorId?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<PostResult> {
    return this.post(c, {
      idempotencyKey: a.key,
      type: a.type,
      reason: a.reason,
      actorId: a.actorId,
      metadata: a.metadata,
      entries: [
        { account: { user: a.userId, currency: a.currency }, amount: -a.amount },
        { account: { system: a.sink, currency: a.currency }, amount: a.amount },
      ],
    });
  }

  async balances(userId: string, c: Queryable = this.db.pool): Promise<Record<Currency, number>> {
    const out = Object.fromEntries(CURRENCIES.map((cur) => [cur, 0])) as Record<Currency, number>;
    for (const r of await rows<{ currency: Currency; balance: number }>(
      c,
      "SELECT currency, balance FROM accounts WHERE owner_type = 'USER' AND owner_id = $1",
      [userId],
    )) {
      out[r.currency] = r.balance;
    }
    return out;
  }

  async history(userId: string, limit: number, cursor?: number) {
    return this.db.query<{
      id: number;
      currency: Currency;
      amount: number;
      balance_after: number;
      type: string;
      reason: string | null;
      created_at: Date;
    }>(
      `SELECT e.id, a.currency, e.amount, e.balance_after, t.type, t.reason, e.created_at
         FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id
         JOIN ledger_transactions t ON t.id = e.tx_id
        WHERE a.owner_type = 'USER' AND a.owner_id = $1 AND ($2::bigint IS NULL OR e.id < $2)
        ORDER BY e.id DESC LIMIT $3`,
      [userId, cursor ?? null, limit],
    );
  }

  private async ensureAccount(c: Queryable, ref: AccountRef): Promise<number> {
    if ("user" in ref) {
      await c.query(
        `INSERT INTO accounts (owner_type, owner_id, currency) VALUES ('USER', $1, $2)
         ON CONFLICT (owner_id, currency) WHERE owner_type = 'USER' DO NOTHING`,
        [ref.user, ref.currency],
      );
      const r = await c.query<{ id: number }>(
        "SELECT id FROM accounts WHERE owner_type = 'USER' AND owner_id = $1 AND currency = $2",
        [ref.user, ref.currency],
      );
      return r.rows[0]!.id;
    }
    const [kind, code] =
      "system" in ref ? (["SYSTEM", ref.system] as const) : (["ESCROW", ref.escrow] as const);
    await c.query(
      `INSERT INTO accounts (owner_type, code, currency) VALUES ($1, $2, $3)
       ON CONFLICT (owner_type, code, currency) WHERE owner_type <> 'USER' DO NOTHING`,
      [kind, code, ref.currency],
    );
    const r = await c.query<{ id: number }>(
      "SELECT id FROM accounts WHERE owner_type = $1 AND code = $2 AND currency = $3",
      [kind, code, ref.currency],
    );
    return r.rows[0]!.id;
  }
}
