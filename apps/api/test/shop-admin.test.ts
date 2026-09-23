import type { HorseSummaryDto, ShopHorseDto, StableDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { ShopService } from "../src/modules/shop/shop.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("sales ring, stable capacity, admin", () => {
  let t: TestApp;
  let user: { token: string; userId: string };
  beforeAll(async () => {
    t = await createTestApp();
    user = await t.login(6001, "Buyer");
    await t.service(ShopService).restock();
  });
  afterAll(() => t.close());

  it("lists a stocked catalogue with prices", async () => {
    const list = await t.get<ShopHorseDto[]>("/shop/horses", user.token);
    expect(list.body).toHaveLength(8);
    expect(list.body.every((h) => h.price >= 500 && h.isHouse)).toBe(true);
    expect(await t.service(ShopService).restock()).toBe(0);
  });

  it("buys a horse atomically, and nobody can buy it twice", async () => {
    const cheapest = (await t.get<ShopHorseDto[]>("/shop/horses", user.token)).body[0]!;
    const other = await t.login(6002, "Rival");
    const ledger = t.service(LedgerService);
    for (const u of [user, other]) {
      await t.db.tx((c) =>
        ledger.credit(c, {
          userId: u.userId,
          currency: "CREDITS",
          amount: 50_000,
          source: "ADMIN_ADJUSTMENT",
          key: `fund:${u.userId}`,
          type: "TEST",
        }),
      );
    }
    const [a, b] = await Promise.all([
      t.post(`/shop/horses/${cheapest.id}/buy`, {}, user.token),
      t.post(`/shop/horses/${cheapest.id}/buy`, {}, other.token),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 404]);
    const winner = a.status === 201 ? user : other;
    const horses = await t.get<HorseSummaryDto[]>("/horses", winner.token);
    expect(horses.body.map((h) => h.id)).toContain(cheapest.id);
    const history = await t.db.query("SELECT reason FROM horse_ownership_history WHERE horse_id = $1", [
      cheapest.id,
    ]);
    expect(history).toHaveLength(1);
  });

  it("enforces stable capacity and upgrades through the ledger", async () => {
    const admin = await t.login(6999, "Eco");
    await t.db.query("UPDATE users SET role = 'ECONOMY_ADMIN' WHERE id = $1", [admin.userId]);
    expect(
      (
        await t.post(
          `/admin/users/${user.userId}/adjust`,
          { currency: "CREDITS", amount: 100_000, reason: "test funding" },
          user.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.post(
          `/admin/users/${user.userId}/adjust`,
          { currency: "CREDITS", amount: 100_000, reason: "test funding" },
          admin.token,
        )
      ).status,
    ).toBe(201);

    const catalogue = (await t.get<ShopHorseDto[]>("/shop/horses", user.token)).body;
    let bought = (await t.get<HorseSummaryDto[]>("/horses", user.token)).body.length;
    for (const h of catalogue) {
      const res = await t.post<{ error?: { code: string } }>(`/shop/horses/${h.id}/buy`, {}, user.token);
      if (res.status === 201) bought++;
      else {
        expect(res.body.error!.code).toBe("STABLE_FULL");
        break;
      }
    }
    expect(bought).toBe(3);
    const up = await t.post<StableDto>("/stable/upgrade", {}, user.token);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ level: 2, capacity: 5 });
    const audit = await t.db.one(
      "SELECT * FROM audit_logs WHERE action = 'BALANCE_ADJUST' AND target_id = $1",
      [user.userId],
    );
    expect(audit).not.toBeNull();
  });

  it("admin economy view reports sources and sinks", async () => {
    const admin = await t.login(6999, "Eco");
    const res = await t.get<{ byReason: { code: string; net: number }[] }>("/admin/economy", admin.token);
    expect(res.status).toBe(200);
    expect(res.body.byReason.find((r) => r.code === "STARTER_GRANT")!.net).toBeGreaterThan(0);
    expect(res.body.byReason.find((r) => r.code === "HORSE_SALES")!.net).toBeLessThan(0);
  });

  it("delivers notifications from the outbox once", async () => {
    await t.db.query(
      "INSERT INTO domain_events (type, aggregate_type, aggregate_id, payload) VALUES ('race_result', 'race', 'r1', $1)",
      [
        JSON.stringify({
          userId: user.userId,
          horseName: "<b>Hax</b>",
          raceName: "Test",
          position: 1,
          field: 8,
          prize: 750,
        }),
      ],
    );
    const svc = t.service(NotificationsService);
    expect(await svc.processOutbox()).toBe(1);
    expect(await svc.processOutbox()).toBe(0);
    const sent = t.bot.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.args[1]));
    expect(sent.some((s) => s.includes("&lt;b&gt;Hax&lt;/b&gt;") && s.includes("1st"))).toBe(true);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
