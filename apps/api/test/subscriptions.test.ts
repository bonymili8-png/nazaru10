import type {
  CosmeticsDto,
  LeaderboardOwnerDto,
  PaymentDto,
  ProductDto,
  SubscriptionDto,
  UserDto,
} from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SubscriptionsService } from "../src/modules/payments/subscriptions.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("Owners' Circle subscription (Telegram Stars)", () => {
  let t: TestApp;
  let user: { token: string; userId: string };
  let other: { token: string; userId: string };
  let first: PaymentDto;
  const TG_ID = 8601;
  const DAY = 86_400_000;
  const hook = (update: unknown) =>
    t.post("/telegram/webhook", update, undefined, {
      "x-telegram-bot-api-secret-token": t.env.TELEGRAM_WEBHOOK_SECRET,
    });
  const paid = (id: number, charge: string, payload: string, expires: Date, recurring = false) =>
    hook({
      update_id: id,
      message: {
        chat: { id: TG_ID },
        from: { id: TG_ID },
        successful_payment: {
          currency: "XTR",
          total_amount: 150,
          invoice_payload: payload,
          telegram_payment_charge_id: charge,
          subscription_expiration_date: Math.floor(expires.getTime() / 1000),
          ...(recurring ? { is_recurring: true } : { is_first_recurring: true }),
        },
      },
    });
  const gems = async () =>
    (await t.get<{ balances: { GEMS: number } }>("/wallet", user.token)).body.balances.GEMS;
  const sub = async () => (await t.get<SubscriptionDto>("/subscription", user.token)).body;
  const setSilks = (token: string) =>
    t.put("/cosmetics/silks", { pattern: "SOLID", primary: "platinum", secondary: "black" }, token);

  beforeAll(async () => {
    t = await createTestApp();
    user = await t.login(TG_ID, "Member");
    other = await t.login(8602, "Guest");
  });
  afterAll(() => t.close());

  it("sells a 30-day Stars subscription invoice", async () => {
    const products = (await t.get<ProductDto[]>("/payments/products", user.token)).body;
    expect(products.find((p) => p.id === "OWNERS_CIRCLE")).toMatchObject({
      priceStars: 150,
      subscriptionDays: 30,
    });
    expect(await sub()).toMatchObject({ status: null, member: false, gemsPerPeriod: 300 });
    first = (await t.post<PaymentDto>("/payments", { productId: "OWNERS_CIRCLE" }, user.token)).body;
    const call = t.bot.calls.find(
      (c) => c.method === "createInvoiceLink" && (c.args[0] as { payload: string }).payload === first.id,
    );
    expect((call!.args[0] as { subscription_period: number }).subscription_period).toBe(30 * 86_400);
  });

  it("starts the membership from the verified payment: gems, badge and member colours", async () => {
    expect((await setSilks(user.token)).status).toBe(409);
    const periodEnd = new Date(t.clock.now().getTime() + 30 * DAY);
    await paid(1, "sub-charge-1", first.id, periodEnd);
    await paid(1, "sub-charge-1", first.id, periodEnd); // duplicate delivery
    expect(await gems()).toBe(300);
    expect(await sub()).toMatchObject({ status: "ACTIVE", member: true });
    expect((await t.get<UserDto>("/me", user.token)).body.member).toBe(true);
    expect((await t.get<CosmeticsDto>("/cosmetics", user.token)).body.member).toBe(true);
    expect((await setSilks(user.token)).status).toBe(200);
    expect((await setSilks(other.token)).status).toBe(409);
    const board = (await t.get<LeaderboardOwnerDto[]>("/leaderboard/owners?by=rating", user.token)).body;
    expect(board.find((o) => o.userId === user.userId)?.member).toBe(true);
    expect(board.find((o) => o.userId === other.userId)?.member).toBe(false);
    // A second subscription is refused while one is active.
    expect((await t.post("/payments", { productId: "OWNERS_CIRCLE" }, user.token)).status).toBe(409);
  });

  it("records each automatic renewal once, with its gems and a longer period", async () => {
    const before = await sub();
    const next = new Date(new Date(before.periodEnd!).getTime() + 30 * DAY);
    await paid(2, "sub-charge-2", first.id, next, true);
    await paid(2, "sub-charge-2", first.id, next, true);
    expect(await gems()).toBe(600);
    expect(new Date((await sub()).periodEnd!).getTime()).toBe(Math.floor(next.getTime() / 1000) * 1000);
    const renewals = await t.db.query("SELECT 1 FROM payments WHERE parent_id = $1", [first.id]);
    expect(renewals).toHaveLength(1);
  });

  it("cancels at Telegram but keeps benefits until the period ends; can resume", async () => {
    const c = await t.post<SubscriptionDto>("/subscription/cancel", {}, user.token);
    expect(c.body).toMatchObject({ status: "CANCELED", member: true });
    expect(t.bot.calls.filter((x) => x.method === "editUserStarSubscription").at(-1)!.args).toEqual([
      TG_ID,
      "sub-charge-2",
      true,
    ]);
    const r = await t.post<SubscriptionDto>("/subscription/resume", {}, user.token);
    expect(r.body.status).toBe("ACTIVE");
    expect(t.bot.calls.filter((x) => x.method === "editUserStarSubscription").at(-1)!.args[2]).toBe(false);
    expect((await t.post("/subscription/resume", {}, user.token)).status).toBe(409);
    expect((await t.post("/subscription/cancel", {}, other.token)).status).toBe(409);
  });

  it("expires after the paid period and a grace day", async () => {
    await t.post("/subscription/cancel", {}, user.token);
    const end = new Date((await sub()).periodEnd!).getTime();
    t.clock.advance(end - t.clock.now().getTime() + 1000);
    expect((await sub()).member).toBe(false);
    expect(await t.service(SubscriptionsService).expireDue()).toBe(0); // grace day
    t.clock.advance(DAY);
    expect(await t.service(SubscriptionsService).expireDue()).toBe(1);
    expect((await sub()).status).toBe("EXPIRED");
    expect((await setSilks(user.token)).status).toBe(409);
    // Subscribing again is allowed once expired.
    expect((await t.post("/payments", { productId: "OWNERS_CIRCLE" }, user.token)).status).toBe(201);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});

describe("refunding a membership payment", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it("claws back the gems, ends the membership and stops renewals", async () => {
    const TG = 8701;
    const user = await t.login(TG, "Refunded");
    const admin = await t.login(8702, "Finance");
    await t.db.query("UPDATE users SET role = 'FINANCE_ADMIN' WHERE id = $1", [admin.userId]);
    const p = (await t.post<PaymentDto>("/payments", { productId: "OWNERS_CIRCLE" }, user.token)).body;
    await t.post(
      "/telegram/webhook",
      {
        update_id: 1,
        message: {
          chat: { id: TG },
          from: { id: TG },
          successful_payment: {
            currency: "XTR",
            total_amount: 150,
            invoice_payload: p.id,
            telegram_payment_charge_id: "refund-me",
            subscription_expiration_date: Math.floor(t.clock.now().getTime() / 1000) + 30 * 86_400,
          },
        },
      },
      undefined,
      { "x-telegram-bot-api-secret-token": t.env.TELEGRAM_WEBHOOK_SECRET },
    );
    expect((await t.get<SubscriptionDto>("/subscription", user.token)).body.member).toBe(true);
    const r = await t.post(`/admin/payments/${p.id}/refund`, { reason: "accidental purchase" }, admin.token);
    expect(r.status).toBe(201);
    expect((await t.get<SubscriptionDto>("/subscription", user.token)).body).toMatchObject({
      status: "EXPIRED",
      member: false,
    });
    const gems = (await t.get<{ balances: { GEMS: number } }>("/wallet", user.token)).body.balances.GEMS;
    expect(gems).toBe(0);
    expect(
      t.bot.calls.some((c) => c.method === "editUserStarSubscription" && c.args[1] === "refund-me"),
    ).toBe(true);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
