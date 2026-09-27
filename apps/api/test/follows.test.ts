import type {
  FollowedHorseDto,
  HorseDetailDto,
  HorseSummaryDto,
  RaceSummaryDto,
} from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotificationsService } from "../src/modules/notifications/notifications.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { ShopService } from "../src/modules/shop/shop.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("following horses", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let fan: { token: string; userId: string };
  let horse: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(4801, "Star");
    fan = await t.login(4802, "Fan");
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("follows and unfollows another owner's horse", async () => {
    expect((await t.get<HorseDetailDto>(`/horses/${horse}`, fan.token)).body).toMatchObject({
      followed: false,
      followers: 0,
    });
    expect((await t.post(`/horses/${horse}/follow`, {}, fan.token)).status).toBe(201);
    await t.post(`/horses/${horse}/follow`, {}, fan.token); // idempotent
    expect((await t.get<HorseDetailDto>(`/horses/${horse}`, fan.token)).body).toMatchObject({
      followed: true,
      followers: 1,
    });
    expect((await t.get<HorseDetailDto>(`/horses/${horse}`, owner.token)).body).toMatchObject({
      followed: false,
      followers: 1,
    });
    expect((await t.del(`/horses/${horse}/follow`, fan.token)).status).toBe(200);
    expect((await t.get<FollowedHorseDto[]>("/me/follows", fan.token)).body).toEqual([]);
  });

  it("refuses house horses", async () => {
    await t.service(ShopService).restock();
    const house = (await t.db.query<{ id: string }>("SELECT id FROM horses WHERE is_house LIMIT 1"))[0]!;
    const r = await t.post<{ error: { code: string } }>(`/horses/${house.id}/follow`, {}, fan.token);
    expect(r.body.error.code).toBe("NOT_FOLLOWABLE");
  });

  it("lists followed horses with their next race and tells followers about a win", async () => {
    await t.post(`/horses/${horse}/follow`, {}, fan.token);
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=5", owner.token))
      .body[0]!;
    // Make the horse far stronger than any maiden field so it wins.
    await t.db.query(
      `UPDATE horses SET attributes = (SELECT jsonb_object_agg(k, 100) FROM jsonb_object_keys(attributes) k)
        WHERE id = $1`,
      [horse],
    );
    await t.post(`/races/${race.id}/entries`, { horseId: horse, strategy: "MID_PACK" }, owner.token);
    const list = (await t.get<FollowedHorseDto[]>("/me/follows", fan.token)).body;
    expect(list).toHaveLength(1);
    expect(list[0]!.horse.id).toBe(horse);
    expect(list[0]!.nextRace?.id).toBe(race.id);

    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.runDue();
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
    const won = await t.db.query(
      "SELECT 1 FROM race_entries WHERE race_id = $1 AND horse_id = $2 AND position = 1",
      [race.id, horse],
    );
    expect(won).toHaveLength(1);
    const events = await t.db.query<{ payload: { userId: string } }>(
      "SELECT payload FROM domain_events WHERE type = 'followed_win'",
    );
    expect(events.map((e) => e.payload.userId)).toEqual([fan.userId]);
    const before = t.bot.calls.filter((c) => c.method === "sendMessage").length;
    await t.service(NotificationsService).processOutbox();
    const texts = t.bot.calls
      .filter((c) => c.method === "sendMessage")
      .slice(before)
      .map((c) => String(c.args[1]));
    expect(texts.some((x) => x.includes("a horse you follow, won"))).toBe(true);
  });
});
