import type { HorseSummaryDto, RaceDetailDto, RaceSummaryDto, StableDto } from "@thoroughline/contracts";
import { defaultConfig as cfg } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { StableService } from "../src/modules/stable/stable.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("race-day gear", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let rival: { token: string; userId: string };
  let horse: string;
  let race: RaceSummaryDto;
  const credits = async () =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", owner.token)).body.balances.CREDITS;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(4301, "Taras");
    rival = await t.login(4302, "Olha");
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
    await t.service(RaceRunnerService).scheduleAhead();
    race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=5", owner.token))
      .body[0]!;
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "CREDITS",
        amount: 5000,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gear:fund",
        type: "TEST",
      }),
    );
  });
  afterAll(() => t.close());

  it("lists the gear on offer, none owned", async () => {
    const s = (await t.get<StableDto>("/stable", owner.token)).body;
    expect(s.gear.map((g) => g.item)).toEqual([
      "BLINKERS",
      "SHADOW_ROLL",
      "TONGUE_TIE",
      "RACING_PLATES",
      "CROSS_NOSEBAND",
    ]);
    expect(s.gear.every((g) => !g.owned)).toBe(true);
    expect(s.gear[0]!.mods).toEqual(cfg.equipment.BLINKERS.mods);
  });

  it("refuses an entry with gear the stable does not own", async () => {
    const r = await t.post<{ error: { code: string } }>(
      `/races/${race.id}/entries`,
      { horseId: horse, strategy: "MID_PACK", gear: "BLINKERS" },
      owner.token,
    );
    expect(r.body.error.code).toBe("GEAR_NOT_OWNED");
  });

  it("buys each item once for credits", async () => {
    const before = await credits();
    const s = await t.post<StableDto>("/stable/gear/BLINKERS", {}, owner.token);
    expect(s.status).toBe(201);
    expect(s.body.gear.find((g) => g.item === "BLINKERS")!.owned).toBe(true);
    expect(await credits()).toBe(before - cfg.equipment.BLINKERS.cost);
    expect(
      (await t.post<{ error: { code: string } }>("/stable/gear/BLINKERS", {}, owner.token)).body.error.code,
    ).toBe("GEAR_OWNED");
    expect((await t.post("/stable/gear/JETPACK", {}, owner.token)).status).toBe(400);
  });

  it("enters with gear, hidden from rivals, and races with it applied", async () => {
    const r = await t.post<RaceDetailDto>(
      `/races/${race.id}/entries`,
      { horseId: horse, strategy: "MID_PACK", gear: "BLINKERS" },
      owner.token,
    );
    expect(r.status).toBe(201);
    expect(r.body.entryList.find((e) => e.horseId === horse)!.gear).toBe("BLINKERS");
    const seen = (await t.get<RaceDetailDto>(`/races/${race.id}`, rival.token)).body;
    expect(seen.entryList.find((e) => e.horseId === horse)!.gear).toBeNull();

    // Lock: the snapshot keeps the horse's real attributes plus the gear.
    const runner = t.service(RaceRunnerService);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    const snap = (
      await t.db.query<{ snapshot: { gear: string; attributes: { focus: number } } }>(
        "SELECT snapshot FROM race_entries WHERE race_id = $1 AND horse_id = $2",
        [race.id, horse],
      )
    )[0]!.snapshot;
    const real = (
      await t.db.query<{ attributes: { focus: number } }>("SELECT attributes FROM horses WHERE id = $1", [
        horse,
      ])
    )[0]!;
    expect(snap.gear).toBe("BLINKERS");
    expect(snap.attributes.focus).toBe(real.attributes.focus);

    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    expect(await runner.runDue()).toBe(1);
    t.clock.advance(5 * 60_000);
    expect(await runner.settleDue()).toBe(1);
    const done = (await t.get<RaceDetailDto>(`/races/${race.id}`, rival.token)).body;
    expect(done.status).toBe("COMPLETED");
    expect(done.entryList.find((e) => e.horseId === horse)!.gear).toBe("BLINKERS");
  });

  it("wears with every race, can be repaired, and wears out", async () => {
    const races = cfg.gearWear.races;
    let g = (await t.get<StableDto>("/stable", owner.token)).body.gear.find((x) => x.item === "BLINKERS")!;
    expect(g.racesLeft).toBe(races - 1); // the race above
    expect(g.repairCost).toBe(Math.round((cfg.equipment.BLINKERS.cost * cfg.gearWear.repairRate) / races));

    const before = await credits();
    const r = await t.post<StableDto>("/stable/gear/BLINKERS/repair", {}, owner.token);
    expect(r.status).toBe(201);
    g = r.body.gear.find((x) => x.item === "BLINKERS")!;
    expect(g).toMatchObject({ racesLeft: races, repairCost: 0 });
    expect(await credits()).toBe(
      before - Math.round((cfg.equipment.BLINKERS.cost * cfg.gearWear.repairRate) / races),
    );
    const fresh = await t.post<{ error: { code: string } }>("/stable/gear/BLINKERS/repair", {}, owner.token);
    expect(fresh.body.error.code).toBe("GEAR_NEW");

    // The last race of its life retires the item.
    await t.db.query(
      "UPDATE stables SET gear_wear = jsonb_build_object('BLINKERS', $2::int) WHERE owner_id = $1",
      [owner.userId, races - 1],
    );
    const stables = t.service(StableService);
    expect(await t.db.tx((c) => stables.wearGear(c, owner.userId, "BLINKERS"))).toBe(true);
    g = (await t.get<StableDto>("/stable", owner.token)).body.gear.find((x) => x.item === "BLINKERS")!;
    expect(g).toMatchObject({ owned: false, racesLeft: null });
    // Worn-out gear is bought again at full price.
    expect((await t.post("/stable/gear/BLINKERS", {}, owner.token)).status).toBe(201);
    g = (await t.get<StableDto>("/stable", owner.token)).body.gear.find((x) => x.item === "BLINKERS")!;
    expect(g.racesLeft).toBe(races);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
