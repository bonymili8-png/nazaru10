import type { GallopDto, GallopsDto, HorseSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

describe("morning gallop", () => {
  let t: TestApp;
  let token: string;
  let horseId: string;
  const work = (body: object) =>
    t.post<GallopDto & { error?: { code: string } }>(`/horses/${horseId}/gallops`, body, token);
  const list = async () => (await t.get<GallopsDto>(`/horses/${horseId}/gallops`, token)).body;
  const fatigue = async () =>
    (await t.db.one<{ fatigue: number }>("SELECT fatigue FROM horses WHERE id = $1", [horseId]))!.fatigue;

  beforeAll(async () => {
    t = await createTestApp();
    ({ token } = await t.login(9831, "Clocker"));
    horseId = (await t.get<HorseSummaryDto[]>("/horses", token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("a fresh horse can work; the list offers the distances", async () => {
    const g = await list();
    expect(g).toMatchObject({ ready: true, block: null, distances: [800, 1200, 1600], history: [] });
  });

  it("works against a class lead horse on the clock, at a fatigue cost", async () => {
    const before = await fatigue();
    const res = await work({ distance: 1200, surface: "TURF", leadClass: "MAIDEN" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ distance: 1200, surface: "TURF", leadClass: "MAIDEN" });
    expect(res.body.time).toBeGreaterThan(60);
    expect(res.body.time).toBeLessThan(100);
    expect(Number.isFinite(res.body.margin)).toBe(true);
    expect(await fatigue()).toBeCloseTo(before + 8, 0);
    expect((await list()).history).toHaveLength(1);
  });

  it("waits for its cooldown, then refuses a tired horse", async () => {
    const again = await work({ distance: 800, surface: "DIRT", leadClass: "CLASS_5" });
    expect(again.status).toBe(409);
    expect(again.body.error!.code).toBe("COOLDOWN");
    expect((await list()).availableAt).not.toBeNull();
    t.clock.advance(20 * 3_600_000);
    await t.db.query("UPDATE horses SET fatigue = 60, condition_updated_at = $2 WHERE id = $1", [
      horseId,
      t.clock.now(),
    ]);
    expect((await list()).block).toBe("TOO_TIRED");
    expect((await work({ distance: 800, surface: "DIRT", leadClass: "CLASS_5" })).body.error!.code).toBe(
      "TOO_TIRED",
    );
  });

  it("rejects odd distances and strangers", async () => {
    expect((await work({ distance: 1000, surface: "TURF", leadClass: "MAIDEN" })).status).toBe(400);
    expect((await work({ distance: 800, surface: "SAND", leadClass: "MAIDEN" })).status).toBe(400);
    const other = await t.login(9832, "Tout");
    expect((await t.get(`/horses/${horseId}/gallops`, other.token)).status).toBe(403);
    expect(
      (
        await t.post(
          `/horses/${horseId}/gallops`,
          { distance: 800, surface: "TURF", leadClass: "MAIDEN" },
          other.token,
        )
      ).status,
    ).toBe(403);
  });
});
