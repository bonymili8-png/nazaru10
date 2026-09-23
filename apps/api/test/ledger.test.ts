import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("ledger", () => {
  let t: TestApp;
  let ledger: LedgerService;
  let userId: string;
  beforeAll(async () => {
    t = await createTestApp();
    ledger = t.service(LedgerService);
    userId = (await t.login(2001)).userId;
  });
  afterAll(() => t.close());

  it("never lets concurrent debits overdraw a wallet", async () => {
    // 5000 starting credits; 50 concurrent debits of 200 → exactly 25 succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        t.db.tx((c) =>
          ledger.debit(c, {
            userId,
            currency: "CREDITS",
            amount: 200,
            sink: "TRAINING",
            key: `burst:${i}`,
            type: "TEST",
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(25);
    for (const r of results)
      if (r.status === "rejected") expect((r.reason as { code: string }).code).toBe("INSUFFICIENT_FUNDS");
    expect((await ledger.balances(userId)).CREDITS).toBe(0);
  });

  it("is idempotent per key, including under concurrency", async () => {
    const runs = await Promise.all(
      Array.from({ length: 10 }, () =>
        t.db.tx((c) =>
          ledger.credit(c, {
            userId,
            currency: "GEMS",
            amount: 7,
            source: "PAYMENTS",
            key: "same-key",
            type: "TEST",
          }),
        ),
      ),
    );
    expect(runs.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await ledger.balances(userId)).GEMS).toBe(7);
  });

  it("rejects malformed postings", async () => {
    await expect(
      t.db.tx((c) =>
        ledger.post(c, {
          idempotencyKey: "bad",
          type: "TEST",
          entries: [
            { account: { user: userId, currency: "CREDITS" }, amount: 5 },
            { account: { system: "TRAINING", currency: "CREDITS" }, amount: -4 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "LEDGER_INVALID" });
    await expect(
      t.db.tx((c) =>
        ledger.credit(c, {
          userId,
          currency: "CREDITS",
          amount: 0,
          source: "PAYMENTS",
          key: "zero",
          type: "TEST",
        }),
      ),
    ).rejects.toMatchObject({ code: "LEDGER_INVALID" });
    await expect(
      t.db.tx((c) =>
        ledger.credit(c, {
          userId,
          currency: "CREDITS",
          amount: 1.5,
          source: "PAYMENTS",
          key: "frac",
          type: "TEST",
        }),
      ),
    ).rejects.toMatchObject({ code: "LEDGER_INVALID" });
  });

  it("rolls back balance changes when the surrounding transaction fails", async () => {
    await expect(
      t.db.tx(async (c) => {
        await ledger.credit(c, {
          userId,
          currency: "CREDITS",
          amount: 999,
          source: "PAYMENTS",
          key: "rollback",
          type: "TEST",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await ledger.balances(userId)).CREDITS).toBe(0);
    expect(await t.db.one("SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'rollback'")).toBeNull();
  });

  it("exposes wallet history newest first with cursor pagination", async () => {
    const { token } = await t.login(2002);
    const page = await t.get<{ items: { amount: number; type: string }[]; nextCursor: number | null }>(
      "/wallet/transactions?limit=1",
      token,
    );
    expect(page.status).toBe(200);
    expect(page.body.items[0]).toMatchObject({ amount: 5000, type: "STARTER_GRANT" });
  });

  it("pays the daily allowance only to nearly-broke owners, once per day", async () => {
    // userId was drained to 0 credits by the burst test.
    const token = (await t.login(2001)).token;
    const w = await t.get<{ allowance: { eligible: boolean; amount: number } }>("/wallet", token);
    expect(w.body.allowance.eligible).toBe(true);
    const claim = await t.post<{ balances: { CREDITS: number }; allowance: { eligible: boolean } }>(
      "/wallet/allowance",
      {},
      token,
    );
    expect(claim.status).toBe(201);
    expect(claim.body.balances.CREDITS).toBe(w.body.allowance.amount);
    expect(claim.body.allowance.eligible).toBe(false);
    const again = await t.post<{ error: { code: string } }>("/wallet/allowance", {}, token);
    expect(again.body.error.code).toBe("ALREADY_CLAIMED");
    const rich = await t.login(2003);
    const no = await t.post<{ error: { code: string } }>("/wallet/allowance", {}, rich.token);
    expect(no.body.error.code).toBe("NOT_ELIGIBLE");
    t.clock.advance(24 * 3_600_000);
    expect((await t.post("/wallet/allowance", {}, token)).status).toBe(201);
  });

  it("keeps invariants", () => assertLedgerIntegrity(t.db));
});
