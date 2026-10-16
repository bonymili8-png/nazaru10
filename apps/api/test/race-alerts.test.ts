import type { HorseSummaryDto, RaceSummaryDto, UserDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngagementService, REPORT } from "../src/modules/notifications/engagement.service.js";
import {
  dailyReportText,
  NotificationsService,
  offSoonText,
} from "../src/modules/notifications/notifications.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

const HOUR = 3_600_000;

describe("race alerts and the morning stable report", () => {
  let t: TestApp;
  let fan: { token: string; userId: string; horseId: string };
  let quiet: { token: string; userId: string; horseId: string };
  let race: RaceSummaryDto;
  const runner = () => t.service(RaceRunnerService);
  const events = (type: string, userId: string) =>
    t.db.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM domain_events WHERE type = $1 AND payload->>'userId' = $2 ORDER BY id",
      [type, userId],
    );
  const sent = () => t.bot.calls.filter((c) => c.method === "sendMessage");

  beforeAll(async () => {
    t = await createTestApp();
    // Start at 06:00 UTC, an hour before the report window opens.
    const now = t.clock.now();
    const six = new Date(now);
    six.setUTCHours(6, 0, 0, 0);
    if (six <= now) six.setUTCDate(six.getUTCDate() + 1);
    t.clock.advance(six.getTime() - now.getTime());
    for (const [id, name, key] of [
      [4801, "Fan", "fan"],
      [4802, "Quiet", "quiet"],
    ] as const) {
      const u = await t.login(id, name);
      const horseId = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id;
      if (key === "fan") fan = { ...u, horseId };
      else quiet = { ...u, horseId };
    }
    // Quiet keeps bot messages but turns both optional kinds off.
    const off = await t.put<UserDto>(
      "/me/settings",
      { raceStartAlerts: false, dailyReport: false },
      quiet.token,
    );
    expect(off.body.settings).toMatchObject({
      notifications: true,
      raceStartAlerts: false,
      dailyReport: false,
    });
  });
  afterAll(() => t.close());

  it("calls each owner's horses to post two minutes before the off, with a watch-live button", async () => {
    await runner().scheduleAhead();
    race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=50", fan.token))
      .body[0]!;
    for (const u of [fan, quiet])
      expect(
        (await t.post(`/races/${race.id}/entries`, { horseId: u.horseId, strategy: "MID_PACK" }, u.token))
          .status,
      ).toBe(201);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner().lockDue();

    const [call] = await events("race_off_soon", fan.userId);
    expect(call!.payload).toMatchObject({ raceId: race.id, field: 8, distance: race.distance });
    const horses = call!.payload.horses as { name: string; gate: number }[];
    expect(horses).toHaveLength(1);
    expect(horses[0]!.gate).toBeGreaterThanOrEqual(1);
    expect(horses[0]!.gate).toBeLessThanOrEqual(8);
    const now = t.clock.now().getTime();
    expect(offSoonText(call!.payload, "en", now)).toMatch(
      /^🏁 <b>.+<\/b> \(gate \d\) goes off in about 2 min — .+, \d[\d,]*m, 8 runners\.$/,
    );
    expect(offSoonText(call!.payload, "uk", now)).toMatch(
      /стартує приблизно за 2 хв — «.+», .+ м, 8 учасників\.$/,
    );
    const m = t
      .service(NotificationsService)
      .render({ id: 0, type: "race_off_soon", payload: call!.payload })!;
    expect(m).toMatchObject({
      path: `/race/?id=${race.id}`,
      button: "📺 Watch live",
      category: "raceStartAlerts",
    });

    // Delivered to the fan only: the quiet owner turned race-start alerts off.
    const before = sent().length;
    await t.service(NotificationsService).processOutbox();
    const texts = sent()
      .slice(before)
      .map((c) => String(c.args[1]));
    expect(texts.filter((x) => x.includes("goes off in about"))).toHaveLength(1);
  });

  it("the race result carries a button that opens the replay", async () => {
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner().runDue();
    t.clock.advance(5 * 60_000);
    await runner().settleDue();
    const [result] = await events("race_result", fan.userId);
    const m = t
      .service(NotificationsService)
      .render({ id: 0, type: "race_result", payload: result!.payload }, "uk")!;
    expect(m).toMatchObject({ path: `/race/?id=${race.id}&replay=1`, button: "▶️ Дивитись повтор" });
    expect(m.category).toBeUndefined();
  });

  it("sends the morning report once a day in the window, to active players who want it", async () => {
    const svc = t.service(EngagementService);
    expect(await svc.reportDue()).toBe(0); // before the window
    // Next morning in the window: yesterday's run is in the report.
    const now = t.clock.now();
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(REPORT.fromHourUtc, 5, 0, 0);
    t.clock.advance(next.getTime() - now.getTime());
    for (const u of [fan, quiet])
      await t.db.query("UPDATE users SET last_seen_at = $2 WHERE id = $1", [
        u.userId,
        new Date(next.getTime() - 3 * HOUR),
      ]);
    expect(await svc.reportDue()).toBe(1);
    expect(await svc.reportDue()).toBe(0); // once a day
    const [report] = await events("daily_report", fan.userId);
    expect(report!.payload).toMatchObject({ runs: 1, bonus: 100 });
    expect((await events("daily_report", quiet.userId)).length).toBe(0);
    const text = dailyReportText(report!.payload, "en");
    expect(text).toContain("Good morning! Your stable report");
    expect(text).toMatch(/Yesterday: 1 run — [01] wins?, [01] in the top 3/);
    expect(text).toContain("Your first race today pays +100 credits.");
    const uk = dailyReportText(report!.payload, "uk");
    expect(uk).toMatch(/Учора: 1 старт — [01] перемог/);
  });

  it("leaves out players away for more than two days (comeback nudges cover them)", async () => {
    const now = t.clock.now();
    t.clock.advance(24 * HOUR);
    await t.db.query("UPDATE users SET last_seen_at = $2 WHERE id = $1", [
      fan.userId,
      new Date(now.getTime() - 3 * HOUR),
    ]);
    expect(await t.service(EngagementService).reportDue()).toBe(1);
    t.clock.advance(24 * HOUR);
    expect(await t.service(EngagementService).reportDue()).toBe(0);
  });
});
