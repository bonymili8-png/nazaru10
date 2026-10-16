import type { AdminGemExchangeDto, GemExchangeDto, GemExchangeResultDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("buying credits with gems", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let admin: { token: string; userId: string };
  let n = 0;
  const offer = async () => (await t.get<GemExchangeDto>("/wallet/exchange", owner.token)).body;
  const buy = (gems: number, credits: number, requestId = `req-${++n}-abcdef`) =>
    t.post<GemExchangeResultDto & { error?: { code: string } }>(
      "/wallet/exchange",
      { gems, credits, requestId },
      owner.token,
    );
  const balances = async () =>
    (await t.get<{ balances: { GEMS: number; CREDITS: number } }>("/wallet", owner.token)).body.balances;
  const toggle = (enabled: boolean, token = admin.token) =>
    t.post<AdminGemExchangeDto>("/admin/gem-exchange", { enabled }, token);

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(9901, "Buyer");
    admin = await t.login(9902, "Treasurer");
    await t.db.query("UPDATE users SET role = 'ECONOMY_ADMIN' WHERE id = $1", [admin.userId]);
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount: 2_000,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:buyer",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
  });
  afterAll(() => t.close());

  it("is on by default and offers bundles at 10 credits a gem with a volume bonus", async () => {
    const o = await offer();
    expect(o).toMatchObject({ enabled: true, baseRate: 10, dailyCreditLimit: 10_000, creditsToday: 0 });
    expect(o.creditsLeft).toBe(10_000);
    expect(o.bundles.map((b) => [b.gems, b.credits, b.bonusPct])).toEqual([
      [50, 500, 0],
      [100, 1_100, 10],
      [250, 3_000, 20],
      [550, 7_000, 27],
    ]);
  });

  it("swaps gems for credits in one balanced posting", async () => {
    const before = await balances();
    const res = await buy(100, 1_100);
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
    expect(res.body.balances.GEMS).toBe(before.GEMS - 100);
    expect(res.body.balances.CREDITS).toBe(before.CREDITS + 1_100);
    expect(res.body.exchange).toMatchObject({ creditsToday: 1_100, creditsLeft: 8_900 });
    const sys = await t.db.query<{ currency: string; balance: number }>(
      "SELECT currency, balance FROM accounts WHERE owner_type = 'SYSTEM' AND code = 'GEM_EXCHANGE' ORDER BY currency",
    );
    expect(sys).toEqual([
      { currency: "CREDITS", balance: -1_100 },
      { currency: "GEMS", balance: 100 },
    ]);
  });

  it("a retried tap with the same request id changes nothing", async () => {
    const first = await buy(50, 500, "same-tap-123456");
    const before = await balances();
    const again = await buy(50, 500, "same-tap-123456");
    expect(again.status).toBe(201);
    expect(again.body.replayed).toBe(true);
    expect(await balances()).toEqual(before);
    expect(first.body.replayed).toBe(false);
  });

  it("refuses unknown bundles, stale amounts and missing gems", async () => {
    expect((await buy(77, 770)).body.error!.code).toBe("UNKNOWN_BUNDLE");
    expect((await buy(100, 1_000)).body.error!.code).toBe("BUNDLE_CHANGED");
    const poor = await t.login(9903, "Skint");
    const res = await t.post<{ error: { code: string } }>(
      "/wallet/exchange",
      { gems: 50, credits: 500, requestId: "poor-owner-1" },
      poor.token,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("caps credits bought per UTC day, then resets", async () => {
    // 1 100 + 500 bought; 7 000 fits, another 3 000 would not.
    expect((await buy(550, 7_000)).status).toBe(201);
    const over = await buy(250, 3_000);
    expect(over.status).toBe(409);
    expect(over.body.error!.code).toBe("DAILY_LIMIT");
    expect((await offer()).creditsLeft).toBe(1_400);
    t.clock.advance(86_400_000);
    expect((await offer()).creditsLeft).toBe(10_000);
    expect((await buy(250, 3_000)).status).toBe(201);
  });

  it("only the economy team sees and flips the switch", async () => {
    expect((await t.get("/admin/gem-exchange", owner.token)).status).toBe(403);
    expect((await toggle(false, owner.token)).status).toBe(403);
    const view = (await t.get<AdminGemExchangeDto>("/admin/gem-exchange", admin.token)).body;
    expect(view.enabled).toBe(true);
    const all = view.stats.find((s) => s.period === "ALL")!;
    expect(all).toMatchObject({ exchanges: 4, owners: 1, gems: 950, credits: 11_600 });
  });

  it("switched off: the shop hides it and the server refuses; on again it works", async () => {
    const off = await toggle(false);
    expect(off.status).toBe(201);
    expect(off.body.enabled).toBe(false);
    expect(off.body.history[0]).toMatchObject({ enabled: false, by: "u9902" });
    expect((await offer()).enabled).toBe(false);
    const res = await buy(50, 500);
    expect(res.status).toBe(409);
    expect(res.body.error!.code).toBe("EXCHANGE_DISABLED");
    // Switching to the same state publishes nothing new.
    const versions = async () => (await t.db.query("SELECT 1 FROM game_config")).length;
    const v = await versions();
    await toggle(false);
    expect(await versions()).toBe(v);

    const on = await toggle(true);
    expect(on.body.enabled).toBe(true);
    expect(on.body.history.map((h) => h.enabled)).toEqual([true, false]);
    expect((await buy(50, 500)).status).toBe(201);
    const audit = await t.db.query<{ action: string }>(
      "SELECT action FROM audit_logs WHERE action = 'GEM_EXCHANGE_SWITCH'",
    );
    expect(audit).toHaveLength(2);
  });

  it("the switch keeps other admin overrides, and bad bundles are refused by config publish", async () => {
    await t.post(
      "/admin/config",
      { override: { economy: { dailyRaceBonus: 120 } }, note: "Raise the race bonus" },
      admin.token,
    );
    await toggle(false);
    const cfg = (
      await t.get<{ override: { economy: Record<string, unknown> } }>("/admin/config", admin.token)
    ).body;
    expect(cfg.override.economy).toMatchObject({ dailyRaceBonus: 120, gemExchange: { enabled: false } });
    const bad = await t.post<{ error: { code: string } }>(
      "/admin/config",
      {
        override: { economy: { gemExchange: { bundles: [{ gems: 0, credits: 10 }] } } },
        note: "Broken bundle",
      },
      admin.token,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_CONFIG");
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
