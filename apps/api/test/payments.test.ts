import type { PaymentDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("payments (Telegram Stars)", () => {
  let t: TestApp;
  let user: { token: string; userId: string };
  const TG_ID = 5001;
  const hook = (update: unknown, secret?: string) =>
    t.post(
      "/telegram/webhook",
      update,
      undefined,
      secret === undefined
        ? { "x-telegram-bot-api-secret-token": t.env.TELEGRAM_WEBHOOK_SECRET }
        : { "x-telegram-bot-api-secret-token": secret },
    );
  const gems = async () =>
    (await t.get<{ balances: { GEMS: number } }>("/wallet", user.token)).body.balances.GEMS;

  beforeAll(async () => {
    t = await createTestApp();
    user = await t.login(TG_ID, "Payer");
  });
  afterAll(() => t.close());

  it("creates an invoice through the provider", async () => {
    const res = await t.post<PaymentDto>("/payments", { productId: "GEMS_100" }, user.token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "CREATED", amount: 50, currency: "XTR" });
    expect(res.body.invoiceLink).toContain(res.body.id);
    expect((await t.post("/payments", { productId: "FREE_MONEY" }, user.token)).status).toBe(404);
  });

  it("rejects webhooks without the secret token", async () => {
    expect((await hook({ update_id: 1 }, "wrong")).status).toBe(401);
    expect((await t.post("/telegram/webhook", { update_id: 1 })).status).toBe(401);
  });

  it("validates pre-checkout queries against the stored order", async () => {
    const p = (await t.post<PaymentDto>("/payments", { productId: "GEMS_550" }, user.token)).body;
    await hook({
      update_id: 2,
      pre_checkout_query: {
        id: "pcq1",
        from: { id: TG_ID },
        currency: "XTR",
        total_amount: 1,
        invoice_payload: p.id,
      },
    });
    await hook({
      update_id: 3,
      pre_checkout_query: {
        id: "pcq2",
        from: { id: 999 },
        currency: "XTR",
        total_amount: 250,
        invoice_payload: p.id,
      },
    });
    await hook({
      update_id: 4,
      pre_checkout_query: {
        id: "pcq3",
        from: { id: TG_ID },
        currency: "XTR",
        total_amount: 250,
        invoice_payload: p.id,
      },
    });
    const answers = t.bot.calls
      .filter((c) => c.method === "answerPreCheckoutQuery")
      .map((c) => c.args.slice(0, 2));
    expect(answers).toEqual([
      ["pcq1", false],
      ["pcq2", false],
      ["pcq3", true],
    ]);
    expect((await t.get<PaymentDto>(`/payments/${p.id}`, user.token)).body.status).toBe("PENDING");
  });

  it("grants gems only from successful_payment, exactly once", async () => {
    const p = (await t.post<PaymentDto>("/payments", { productId: "GEMS_1200" }, user.token)).body;
    expect(await gems()).toBe(0);
    const msg = {
      update_id: 10,
      message: {
        chat: { id: TG_ID },
        from: { id: TG_ID },
        successful_payment: {
          currency: "XTR",
          total_amount: 500,
          invoice_payload: p.id,
          telegram_payment_charge_id: "charge-1",
        },
      },
    };
    await hook(msg);
    await hook(msg);
    await Promise.all([hook(msg), hook(msg)]);
    expect(await gems()).toBe(1200);
    expect((await t.get<PaymentDto>(`/payments/${p.id}`, user.token)).body.status).toBe("COMPLETED");
  });

  it("ignores mismatching payments", async () => {
    const p = (await t.post<PaymentDto>("/payments", { productId: "GEMS_100" }, user.token)).body;
    await hook({
      update_id: 11,
      message: {
        chat: { id: 7 },
        from: { id: 7 },
        successful_payment: {
          currency: "XTR",
          total_amount: 50,
          invoice_payload: p.id,
          telegram_payment_charge_id: "charge-x",
        },
      },
    });
    expect(await gems()).toBe(1200);
  });

  it("enforces once-per-user packs", async () => {
    const p = (await t.post<PaymentDto>("/payments", { productId: "ROOKIE_PACK" }, user.token)).body;
    await hook({
      update_id: 12,
      message: {
        chat: { id: TG_ID },
        from: { id: TG_ID },
        successful_payment: {
          currency: "XTR",
          total_amount: 100,
          invoice_payload: p.id,
          telegram_payment_charge_id: "charge-2",
        },
      },
    });
    expect((await t.post("/payments", { productId: "ROOKIE_PACK" }, user.token)).status).toBe(409);
  });

  it("refunds only for finance admins, clawing back gems and calling Telegram", async () => {
    const paid = await t.db.one<{ id: string }>(
      "SELECT id FROM payments WHERE provider_charge_id = 'charge-1'",
    );
    expect(
      (await t.post(`/admin/payments/${paid!.id}/refund`, { reason: "customer request" }, user.token)).status,
    ).toBe(403);
    const admin = await t.login(5999, "Fin");
    await t.db.query("UPDATE users SET role = 'FINANCE_ADMIN' WHERE id = $1", [admin.userId]);
    const res = await t.post<PaymentDto>(
      `/admin/payments/${paid!.id}/refund`,
      { reason: "customer request" },
      admin.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("REFUNDED");
    expect(await gems()).toBe(1200 + 300 - 1200);
    expect(t.bot.calls.some((c) => c.method === "refundStarPayment" && c.args[1] === "charge-1")).toBe(true);
    expect(
      (await t.post(`/admin/payments/${paid!.id}/refund`, { reason: "again please" }, admin.token)).status,
    ).toBe(409);
    const audit = await t.db.one(
      "SELECT * FROM audit_logs WHERE action = 'PAYMENT_REFUND' AND target_id = $1",
      [paid!.id],
    );
    expect(audit).not.toBeNull();
  });

  it("answers bot commands, including payment support", async () => {
    await hook({ update_id: 20, message: { chat: { id: TG_ID }, from: { id: TG_ID }, text: "/paysupport" } });
    expect(
      t.bot.calls.some((c) => c.method === "sendMessage" && String(c.args[1]).includes("Payment support")),
    ).toBe(true);
  });

  it("registers the bot command menu on startup", () => {
    const call = t.bot.calls.find((c) => c.method === "setMyCommands");
    const names = (call?.args[0] as { command: string }[]).map((c) => c.command);
    expect(names).toEqual(expect.arrayContaining(["start", "paysupport", "terms", "help"]));
  });

  it("answers /paysupport with the player's recent purchases and /terms with the purchase terms", async () => {
    const sent = () => t.bot.calls.filter((c) => c.method === "sendMessage");
    const before = sent().length;
    await hook({ update_id: 90, message: { chat: { id: TG_ID }, from: { id: TG_ID }, text: "/paysupport" } });
    const support = String(sent()[before]!.args[1]);
    expect(support).toContain("Payment support");
    const completed = await t.db.one<{ id: string }>(
      "SELECT id FROM payments WHERE status = 'COMPLETED' ORDER BY created_at DESC LIMIT 1",
    );
    expect(support).toContain(completed!.id.slice(0, 8));

    await hook({ update_id: 91, message: { chat: { id: 777 }, from: { id: 777 }, text: "/paysupport" } });
    expect(String(sent()[before + 1]!.args[1])).toContain("could not find purchases");

    await hook({ update_id: 92, message: { chat: { id: TG_ID }, from: { id: TG_ID }, text: "/terms" } });
    const terms = String(sent()[before + 2]!.args[1]);
    expect(terms).toContain("Terms of purchase");
    expect(terms).toContain("no cash value");
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
