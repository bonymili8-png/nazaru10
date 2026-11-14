import {
  defaultConfig,
  fitsHousePool,
  houseRatingCap,
  houseStartingRating,
  type RaceClass,
  ratedClassFor,
  Rng,
} from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HorseSummaryDto, RaceSummaryDto } from "@thoroughline/contracts";
import { HouseService, OFF_POOL } from "../src/modules/races/house.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { ShopService } from "../src/modules/shop/shop.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("house fillers", () => {
  let t: TestApp;
  let house: HouseService;
  const fill = (n: number, seed: string, cls: RaceClass = "MAIDEN") =>
    t.db.tx((c) => house.fillers(c, cls, n, 1400, t.clock.now(), new Rng(seed)));

  beforeAll(async () => {
    t = await createTestApp();
    house = t.service(HouseService);
  });
  afterAll(() => t.close());

  it("never fields a tired house horse; rested ones are reused", async () => {
    const first = (await fill(3, "a")).map((h) => h.id);
    expect(first).toHaveLength(3);

    // Just raced: tired. The next field gets fresh horses instead.
    await t.db.query(
      "UPDATE horses SET fatigue = 45, health = 100, condition_updated_at = $2 WHERE id = ANY($1::uuid[])",
      [first, t.clock.now()],
    );
    const second = (await fill(3, "b")).map((h) => h.id);
    expect(second.some((id) => first.includes(id))).toBe(false);

    // Rested for a day since that race: back into the pool (the fresh ones are now tired).
    await t.db.query("UPDATE horses SET condition_updated_at = $2 WHERE id = ANY($1::uuid[])", [
      first,
      new Date(t.clock.now().getTime() - 30 * 3_600_000),
    ]);
    await t.db.query("UPDATE horses SET fatigue = 45, condition_updated_at = $2 WHERE id = ANY($1::uuid[])", [
      second,
      t.clock.now(),
    ]);
    const third = (await fill(3, "c")).map((h) => h.id);
    expect(third.every((id) => first.includes(id))).toBe(true);
  });

  it("never fields a house horse stronger than the class's own", async () => {
    const cap = houseRatingCap("MAIDEN", defaultConfig);
    const fresh = (await fill(4, "d")).map((h) => h.id);
    expect(fresh).toHaveLength(4);
    // Make these rested but over-strong (e.g. an unsold sale-ring horse that drifted in).
    await t.db.query(
      "UPDATE horses SET ability_rating = $2, fatigue = 0, condition_updated_at = $3 WHERE id = ANY($1::uuid[])",
      [fresh, cap + 5, t.clock.now()],
    );
    const field = await fill(4, "e");
    expect(field.some((h) => fresh.includes(h.id))).toBe(false);
    expect(field.every((h) => h.ability_rating <= cap)).toBe(true);
  });

  it("retires stale sale-ring horses off the racing pool", async () => {
    const shop = t.service(ShopService);
    await shop.restock();
    const listed = await t.db.query<{ id: string }>(
      "SELECT id FROM horses WHERE is_house AND sale_price IS NOT NULL AND house_class = 'SHOP'",
    );
    expect(listed.length).toBeGreaterThan(0);
    t.clock.advance(10 * 24 * 3_600_000);
    await shop.restock();
    const moved = await t.db.query<{ house_class: string }>(
      "SELECT house_class FROM horses WHERE id = ANY($1::uuid[])",
      [listed.map((h) => h.id)],
    );
    expect(moved.every((h) => h.house_class === OFF_POOL)).toBe(true);
  });

  it("keeps to the class's entry rules: its rating band, and no winners in maidens", async () => {
    // Fresh house horses are rated like their class's runners.
    const c4 = await fill(3, "f", "CLASS_4");
    expect(c4.every((h) => h.race_rating === houseStartingRating("CLASS_4", defaultConfig))).toBe(true);
    expect(houseStartingRating("CLASS_4", defaultConfig)).toBe(1150);
    expect(houseStartingRating("CLASS_5", defaultConfig)).toBe(1000);
    expect(houseStartingRating("CLASS_1", defaultConfig)).toBe(1450);
    const c5 = (await fill(3, "g", "CLASS_5")).map((h) => h.id);
    // These rested Class 5 house horses have won their way to a Class 4 rating: no longer Class 5.
    await t.db.query(
      "UPDATE horses SET race_rating = 1120, fatigue = 0, condition_updated_at = $2 WHERE id = ANY($1::uuid[])",
      [c5, t.clock.now()],
    );
    const field = await fill(3, "h", "CLASS_5");
    expect(field.some((h) => c5.includes(h.id))).toBe(false);
    expect(field.every((h) => h.race_rating <= 1099)).toBe(true);
    // A maiden pool horse that has won never runs in a maiden again.
    const m = (await fill(2, "i")).map((h) => h.id);
    await t.db.query(
      "UPDATE horses SET starts = 1, wins = 1, fatigue = 0, condition_updated_at = $2 WHERE id = ANY($1::uuid[])",
      [m, t.clock.now()],
    );
    expect((await fill(2, "j")).some((h) => m.includes(h.id))).toBe(false);
    // Where they belong instead.
    expect(fitsHousePool("CLASS_5", 1120, 3, defaultConfig)).toBe(false);
    expect(ratedClassFor(1120, defaultConfig)).toBe("CLASS_4");
    expect(fitsHousePool("MAIDEN", 1000, 1, defaultConfig)).toBe(false);
    expect(ratedClassFor(1000, defaultConfig)).toBe("CLASS_5");
    expect(fitsHousePool("CLASS_5", 1099, 7, defaultConfig)).toBe(true);
  });

  it("moves a house horse that rated out of its class into the class its rating fits", async () => {
    const u = await t.login(9951, "Rider");
    const horseId = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id;
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=CLASS_5&limit=50", u.token))
      .body[0]!;
    expect(
      (await t.post(`/races/${race.id}/entries`, { horseId, strategy: "MID_PACK" }, u.token)).status,
    ).toBe(201);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    // The house runners sit just under the Class 5 ceiling: a good run lifts them over it.
    const house = await t.db.query<{ horse_id: string }>(
      "SELECT horse_id FROM race_entries WHERE race_id = $1 AND is_house",
      [race.id],
    );
    const ids = house.map((h) => h.horse_id);
    expect(ids.length).toBeGreaterThan(2);
    await t.db.query("UPDATE horses SET race_rating = 1098 WHERE id = ANY($1::uuid[])", [ids]);
    await t.db.query("UPDATE race_entries SET rating_before = 1098 WHERE race_id = $1 AND is_house", [
      race.id,
    ]);
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.runDue();
    t.clock.advance(10 * 60_000);
    await runner.settleDue();
    const after = await t.db.query<{ race_rating: number; house_class: string }>(
      "SELECT race_rating, house_class FROM horses WHERE id = ANY($1::uuid[])",
      [ids],
    );
    expect(after.some((h) => h.race_rating > 1099)).toBe(true);
    for (const h of after) expect(h.house_class).toBe(h.race_rating > 1099 ? "CLASS_4" : "CLASS_5");
  });
});
