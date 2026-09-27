import type { HorseDetailDto, HorseSummaryDto } from "@thoroughline/contracts";
import { defaultConfig as cfg, feedEffect, projectCondition } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { NutritionService } from "../src/modules/horses/nutrition.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

const DAY = 86_400_000;
const PREMIUM = cfg.nutrition.plans.PREMIUM.weeklyCost;
const ELITE = cfg.nutrition.plans.ELITE.weeklyCost;

describe("feed plans", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let other: { token: string; userId: string };
  let horse: string;
  const credits = async () =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", owner.token)).body.balances.CREDITS;
  const detail = async () => (await t.get<HorseDetailDto>(`/horses/${horse}`, owner.token)).body;
  const feed = (plan: string, token = owner.token) =>
    t.post<HorseDetailDto & { error?: { code: string } }>(`/horses/${horse}/feed`, { plan }, token);

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(4201, "Iryna");
    other = await t.login(4202, "Petro");
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("starts on the free standard plan and lists the offer", async () => {
    const f = (await detail()).private!.feed;
    expect(f).toMatchObject({ plan: "STANDARD", paidUntil: null, renews: false });
    expect(f.options.map((o) => [o.plan, o.weeklyCost])).toEqual([
      ["STANDARD", 0],
      ["PREMIUM", PREMIUM],
      ["ELITE", ELITE],
    ]);
    expect((await t.get<HorseDetailDto>(`/horses/${horse}`, other.token)).body.private).toBeNull();
  });

  it("charges a week in advance and only the owner may choose", async () => {
    expect((await feed("PREMIUM", other.token)).status).toBe(403);
    expect((await feed("DELUXE")).status).toBe(400);
    const before = await credits();
    const res = await feed("PREMIUM");
    expect(res.status).toBe(201);
    const f = res.body.private!.feed;
    expect(f).toMatchObject({ plan: "PREMIUM", renews: true });
    expect(new Date(f.paidUntil!).getTime() - t.clock.now().getTime()).toBeGreaterThan(7 * DAY - 5000);
    expect(await credits()).toBe(before - PREMIUM);
    // Choosing the same plan again costs nothing.
    await feed("PREMIUM");
    expect(await credits()).toBe(before - PREMIUM);
  });

  it("speeds up recovery from the moment the plan starts", async () => {
    const at = t.clock.now();
    await t.db.query(
      "UPDATE horses SET fatigue = 80, health = 60, form = 1, condition_updated_at = $2 WHERE id = $1",
      [horse, at],
    );
    t.clock.advance(5 * 3_600_000);
    const h = await detail();
    const stored = { fatigue: 80, health: 60, form: 1, updatedAt: at };
    const endurance = h.private!.attributes.endurance;
    const want = projectCondition(stored, t.clock.now(), endurance, cfg, feedEffect("PREMIUM", cfg));
    const plain = projectCondition(stored, t.clock.now(), endurance, cfg);
    expect(h.private!.condition.fatigue).toBeCloseTo(want.fatigue, 0);
    expect(h.private!.condition.fatigue).toBeLessThan(plain.fatigue);
    expect(h.private!.condition.health).toBeGreaterThan(plain.health);
  });

  it("renews weekly, and switching plan starts a new paid week", async () => {
    const svc = t.service(NutritionService);
    const first = (await detail()).private!.feed;
    const before = await credits();
    t.clock.advance(new Date(first.paidUntil!).getTime() - t.clock.now().getTime() + 1000);
    expect(await svc.renewDue()).toBe(1);
    expect(await svc.renewDue()).toBe(0);
    const renewed = (await detail()).private!.feed;
    expect(new Date(renewed.paidUntil!).getTime()).toBe(new Date(first.paidUntil!).getTime() + 7 * DAY);
    expect(await credits()).toBe(before - PREMIUM);

    await feed("ELITE");
    expect(await credits()).toBe(before - PREMIUM - ELITE);
    expect((await detail()).private!.feed.plan).toBe("ELITE");
  });

  it("standard stops renewal: the paid week runs out, then no charge", async () => {
    const svc = t.service(NutritionService);
    const res = await feed("STANDARD");
    expect(res.body.private!.feed).toMatchObject({ plan: "ELITE", renews: false });
    const before = await credits();
    t.clock.advance(8 * DAY);
    expect(await svc.renewDue()).toBe(1);
    expect((await detail()).private!.feed).toMatchObject({ plan: "STANDARD", paidUntil: null });
    expect(await credits()).toBe(before);
    // A plan stopped on purpose does not notify.
    expect(await t.db.query("SELECT 1 FROM domain_events WHERE type = 'feed_lapsed'")).toHaveLength(0);
  });

  it("lapses to standard when the owner cannot pay, and tells them", async () => {
    const svc = t.service(NutritionService);
    await feed("PREMIUM");
    const balance = await credits();
    await t.db.tx((c) =>
      t.service(LedgerService).debit(c, {
        userId: owner.userId,
        currency: "CREDITS",
        amount: balance - (PREMIUM - 1),
        sink: "ADMIN_ADJUSTMENT",
        key: "test:drain:feed",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    t.clock.advance(7 * DAY + 1000);
    expect(await svc.renewDue()).toBe(1);
    expect((await detail()).private!.feed.plan).toBe("STANDARD");
    expect(await credits()).toBe(PREMIUM - 1);
    expect(await t.db.query("SELECT 1 FROM domain_events WHERE type = 'feed_lapsed'")).toHaveLength(1);
    expect((await feed("PREMIUM")).body.error!.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("does not travel with a sold horse", async () => {
    await t.db.query(
      `UPDATE horses SET feed_plan = 'ELITE', feed_paid_until = $2, feed_periods = 1 WHERE id = $1`,
      [horse, new Date(t.clock.now().getTime() + DAY)],
    );
    const { transferHorse } = await import("../src/modules/horses/horse.repo.js");
    const stable = (
      await t.db.query<{ id: string }>("SELECT id FROM stables WHERE owner_id = $1", [other.userId])
    )[0]!;
    const moved = await t.db.tx((c) =>
      transferHorse(
        c,
        { id: horse, owner_id: owner.userId },
        { userId: other.userId, stableId: stable.id },
        "TEST",
        null,
        t.clock.now(),
      ),
    );
    expect(moved).toMatchObject({ feed_plan: "STANDARD", feed_paid_until: null });
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
