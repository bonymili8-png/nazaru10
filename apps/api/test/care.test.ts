import type { CareRoundDto, HorseDetailDto, HorseSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers.js";

describe("daily care", () => {
  let t: TestApp;
  let token: string;
  let horseId: string;
  const detail = async () => (await t.get<HorseDetailDto>(`/horses/${horseId}`, token)).body.private!;
  const act = (a: string) => t.post<{ error?: { code: string } }>(`/horses/${horseId}/care/${a}`, {}, token);
  const action = async (a: string) => (await detail()).care.actions.find((x) => x.action === a)!;

  beforeAll(async () => {
    t = await createTestApp();
    ({ token } = await t.login(9811, "Groom"));
    horseId = (await t.get<HorseSummaryDto[]>("/horses", token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("offers care a new horse can have, and explains the rest", async () => {
    const care = (await detail()).care;
    expect(care).toMatchObject({ bond: 0, shoeStarts: 0, massaged: false });
    expect(await action("GROOM")).toMatchObject({ ready: true, block: null });
    expect(await action("COLD_HOSE")).toMatchObject({ ready: false, block: "NO_RECENT_RACE" });
    expect(await action("FARRIER")).toMatchObject({ ready: false, block: "SHOES_FRESH" });
    expect((await act("TELEPORT")).status).toBe(400);
  });

  it("grooming builds trust, then waits for its cooldown", async () => {
    expect((await act("GROOM")).status).toBe(201);
    expect((await detail()).care.bond).toBe(3);
    const again = await act("GROOM");
    expect(again.status).toBe(409);
    expect(again.body.error!.code).toBe("COOLDOWN");
    expect((await action("GROOM")).availableAt).not.toBeNull();
    t.clock.advance(8 * 3_600_000);
    expect((await act("GROOM")).status).toBe(201);
  });

  it("a walk in hand takes fatigue off at once", async () => {
    await t.db.query("UPDATE horses SET fatigue = 30, condition_updated_at = $2 WHERE id = $1", [
      horseId,
      t.clock.now(),
    ]);
    expect((await act("HAND_WALK")).status).toBe(201);
    expect((await detail()).condition.fatigue).toBeCloseTo(27, 0);
  });

  it("cold hosing is for the legs right after a race, once per race", async () => {
    await t.db.query("UPDATE horses SET last_race_at = $2, hosed_last_race = false WHERE id = $1", [
      horseId,
      new Date(t.clock.now().getTime() - 3_600_000),
    ]);
    expect((await act("COLD_HOSE")).status).toBe(201);
    expect((await act("COLD_HOSE")).body.error!.code).toBe("ALREADY_HOSED");
  });

  it("massage waits for the next start; the farrier resets worn shoes", async () => {
    expect((await act("MASSAGE")).status).toBe(201);
    expect((await detail()).care.massaged).toBe(true);
    await t.db.query("UPDATE horses SET shoe_starts = 6 WHERE id = $1", [horseId]);
    expect(await action("FARRIER")).toMatchObject({ ready: true });
    expect((await act("FARRIER")).status).toBe(201);
    expect((await detail()).care.shoeStarts).toBe(0);
  });

  it("the stable round lists every horse with what it can have now", async () => {
    const round = (await t.get<CareRoundDto>("/horses/care/round", token)).body;
    const me = round.horses.find((h) => h.horseId === horseId)!;
    expect(me.bond).toBeGreaterThan(0);
    expect(me.ready).not.toContain("GROOM"); // groomed in this window
    expect(me.ready).not.toContain("FARRIER"); // fresh shoes
  });

  it("other owners cannot care for your horse", async () => {
    const other = await t.login(9812, "Stranger");
    expect((await t.post(`/horses/${horseId}/care/GROOM`, {}, other.token)).status).toBe(403);
  });
});
