import { defaultConfig, houseRatingCap, Rng } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HouseService, OFF_POOL } from "../src/modules/races/house.service.js";
import { ShopService } from "../src/modules/shop/shop.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

describe("house fillers", () => {
  let t: TestApp;
  let house: HouseService;
  const fill = (n: number, seed: string) =>
    t.db.tx((c) => house.fillers(c, "MAIDEN", n, 1400, t.clock.now(), new Rng(seed)));

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
});
