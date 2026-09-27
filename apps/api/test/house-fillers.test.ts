import { Rng } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HouseService } from "../src/modules/races/house.service.js";
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
});
