import type { AutoTrainerDto, HorseSummaryDto, RaceSummaryDto } from "@thoroughline/contracts";
import { trainingPriorities, sessionFor, defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { AutoTrainerService } from "../src/modules/training/auto-trainer.service.js";
import { TrainingService } from "../src/modules/training/training.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

const HOUR = 3_600_000;

describe("the auto-trainer", () => {
  let t: TestApp;
  let me: { token: string; userId: string };
  let horses: string[];
  const svc = () => t.service(AutoTrainerService);
  const fund = (currency: "CREDITS" | "GEMS", amount: number) =>
    t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: me.userId,
        currency,
        amount,
        source: "ADMIN_ADJUSTMENT",
        key: `fund:${me.userId}:${Math.random()}`,
        type: "TEST",
      }),
    );
  const balance = async () => t.service(LedgerService).balances(me.userId);
  const sessions = () =>
    t.db.query<{ horse_id: string; type: string; intensity: string; start_state: { auto?: boolean } }>(
      "SELECT horse_id, type, intensity, start_state FROM training_sessions WHERE owner_id = $1 ORDER BY started_at, horse_id",
      [me.userId],
    );
  /** Move the clock to the next `hour`:30 UTC (the owner's zone is UTC here). */
  const at = (hour: number) => {
    const now = t.clock.now();
    const d = new Date(now);
    d.setUTCHours(hour, 30, 0, 0);
    if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
    t.clock.advance(d.getTime() - now.getTime());
  };
  /** Rest every horse fully and finish their sessions. */
  const rest = async () => {
    await t.service(TrainingService).settleAllDue();
    await t.db.query(
      "UPDATE horses SET fatigue = 0, health = 100, condition_updated_at = $2 WHERE owner_id = $1 AND status = 'IDLE'",
      [me.userId, t.clock.now()],
    );
  };

  beforeAll(async () => {
    t = await createTestApp();
    me = await t.login(9601, "Trainer");
    await t.giveKeeper(me.userId);
    horses = (await t.get<HorseSummaryDto[]>("/horses", me.token)).body.map((h) => h.id);
    // Racing age and in their prime, fully rested.
    await t.db.query(
      "UPDATE horses SET birth_at = $2, fatigue = 0, health = 100, condition_updated_at = $3 WHERE owner_id = $1",
      [me.userId, new Date(t.clock.now().getTime() - 2 * 28 * 24 * HOUR - 98 * 24 * HOUR), t.clock.now()],
    );
    await fund("CREDITS", 50_000);
  });
  afterAll(() => t.close());

  it("is hired for a month with gems, in the phone's time zone", async () => {
    const v = await t.get<AutoTrainerDto>("/stable/auto-trainer", me.token);
    expect(v.body).toMatchObject({
      active: false,
      priceGems: 1000,
      days: 30,
      minCredits: 10_000,
      hours: [9, 16],
    });
    expect((await t.post("/stable/auto-trainer", { timezone: "UTC" }, me.token)).status).toBe(409);
    await fund("GEMS", 2500);
    expect((await t.post("/stable/auto-trainer", { timezone: "Mars/Olympus" }, me.token)).status).toBe(400);
    const r = await t.post<AutoTrainerDto>("/stable/auto-trainer", { timezone: "UTC" }, me.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ active: true, timezone: "UTC", paused: false });
    expect(
      Math.abs(new Date(r.body.paidUntil!).getTime() - t.clock.now().getTime() - 30 * 24 * HOUR),
    ).toBeLessThan(1000);
    expect((await balance()).GEMS).toBe(1500);
    // A second month can be paid ahead, not a third.
    expect((await t.post("/stable/auto-trainer", {}, me.token)).status).toBe(200);
    expect(
      (await t.post<{ error: { code: string } }>("/stable/auto-trainer", {}, me.token)).body.error.code,
    ).toBe("TOO_FAR_AHEAD");
  });

  it("at 09:00 trains every rested horse on its most relevant attribute, hard", async () => {
    at(7);
    expect(await svc().runDue()).toBe(0);
    at(9);
    expect(await svc().runDue()).toBe(horses.length);
    const list = await sessions();
    expect(list).toHaveLength(horses.length);
    for (const s of list) {
      const h = await t.db.one<{ attributes: never; genome: { aptitudes: never } }>(
        "SELECT attributes, genome FROM horses WHERE id = $1",
        [s.horse_id],
      );
      const top = trainingPriorities(h!.attributes, h!.genome.aptitudes)[0]!;
      expect(s).toMatchObject({ type: sessionFor(top.attribute, defaultConfig), intensity: "HARD" });
      expect(s.start_state.auto).toBe(true);
    }
    // Once a morning.
    await rest();
    expect(await svc().runDue()).toBe(0);
  });

  it("at 16:00 adds a safe normal session on another attribute", async () => {
    const morning = await sessions();
    at(16);
    await t.service(TrainingService).settleAllDue();
    expect(await svc().runDue()).toBe(horses.length);
    const afternoon = (await sessions()).slice(morning.length);
    for (const s of afternoon) {
      expect(s.intensity).toBe("NORMAL");
      expect(s.type).not.toBe(morning.find((m) => m.horse_id === s.horse_id)!.type);
    }
    // No third session that day.
    await rest();
    expect(await svc().runDue()).toBe(0);
    const v = await t.get<AutoTrainerDto>("/stable/auto-trainer", me.token);
    expect(v.body.recent.map((r) => r.slot)).toContain("AFTERNOON");
  });

  it("leaves horses that are not free, or not rested, alone", async () => {
    at(9);
    await rest();
    // One is entered in a race; one is still tired.
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&limit=50", me.token)).body.find(
      (r) => r.class === "CLASS_5",
    )!;
    const entered = await t.post<{ error?: unknown }>(
      `/races/${race.id}/entries`,
      { horseId: horses[0], strategy: "MID_PACK" },
      me.token,
    );
    expect(entered.status, JSON.stringify(entered.body)).toBe(201);
    await t.db.query("UPDATE horses SET fatigue = 20, condition_updated_at = $2 WHERE id = $1", [
      horses[1],
      t.clock.now(),
    ]);
    const before = (await sessions()).length;
    await svc().runDue();
    const fresh = (await sessions()).slice(before).map((s) => s.horse_id);
    expect(fresh).not.toContain(horses[0]);
    expect(fresh).not.toContain(horses[1]);
    expect((await t.del(`/races/${race.id}/entries/${horses[0]}`, me.token)).status).toBe(200);
  });

  it("never takes the wallet under 10 000 credits, and says so once a day", async () => {
    at(9);
    await rest();
    const { CREDITS } = await balance();
    await t.db.tx((c) =>
      t.service(LedgerService).debit(c, {
        userId: me.userId,
        currency: "CREDITS",
        amount: CREDITS - 10_050,
        sink: "TRAINING",
        key: `drain:${Math.random()}`,
        type: "TEST",
      }),
    );
    const before = (await sessions()).length;
    expect(await svc().runDue()).toBe(0);
    expect(await svc().runDue()).toBe(0);
    expect((await sessions()).length).toBe(before);
    expect((await balance()).CREDITS).toBe(10_050);
    const alerts = await t.db.query("SELECT 1 FROM domain_events WHERE type = 'auto_trainer_low_credits'");
    expect(alerts).toHaveLength(1);
    await fund("CREDITS", 20_000);
  });

  it("does not message the owner about its routine sessions", () => {
    const n = t.service(NotificationsService);
    const ev = (p: Record<string, unknown>) => ({
      id: 1,
      type: "training_completed",
      payload: { userId: "u", horseName: "X", ...p },
    });
    expect(n.render(ev({ auto: true }))).toBeNull();
    expect(n.render(ev({ auto: true, injury: "MINOR" }))?.text).toContain("injury");
    expect(n.render(ev({}))?.text).toContain("finished training");
  });

  it("can be paused, and stops when its months are over", async () => {
    at(9);
    await rest();
    await t.post("/stable/auto-trainer/pause", { paused: true }, me.token);
    expect(await svc().runDue()).toBe(0);
    await t.post("/stable/auto-trainer/pause", { paused: false }, me.token);
    t.clock.advance(61 * 24 * HOUR);
    at(9);
    await rest();
    expect(await svc().runDue()).toBe(0);
    expect((await t.get<AutoTrainerDto>("/stable/auto-trainer", me.token)).body.active).toBe(false);
    expect(await t.db.query("SELECT 1 FROM domain_events WHERE type = 'auto_trainer_expired'")).toHaveLength(
      1,
    );
    expect((await t.post("/stable/auto-trainer/pause", { paused: true }, me.token)).status).toBe(409);
  });
});
