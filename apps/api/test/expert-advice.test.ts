import type { ExpertAdviceDto, HorseSummaryDto, RaceSummaryDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type Err = { error: { code: string } };

describe("expert trainer's advice", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let rival: { token: string; userId: string };
  let horse: string;
  const url = () => `/horses/${horse}/advice/expert`;
  const gems = async () =>
    (await t.get<{ balances: { GEMS: number } }>("/wallet", owner.token)).body.balances.GEMS;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(5101, "Planner");
    rival = await t.login(5102, "Peeker");
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("is locked, priced and private", async () => {
    const r = await t.get<ExpertAdviceDto>(url(), owner.token);
    expect(r.body).toMatchObject({
      locked: true,
      priceGems: defaultConfig.economy.expertAdviceGems,
      advice: null,
    });
    expect((await t.get(url(), rival.token)).status).toBe(403);
    expect((await t.post(`${url()}/unlock`, {}, rival.token)).status).toBe(403);
    const broke = await t.post<Err>(`${url()}/unlock`, {}, owner.token);
    expect(broke.body.error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("unlocks once per horse and explains it, with its own race record", async () => {
    // One run first, so the record has something in it.
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=5", owner.token))
      .body[0]!;
    await t.post(`/races/${race.id}/entries`, { horseId: horse, strategy: "CLOSER" }, owner.token);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.runDue();
    t.clock.advance(5 * 60_000);
    await runner.settleDue();

    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount: 100,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:planner",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    const r = await t.post<ExpertAdviceDto>(`${url()}/unlock`, {}, owner.token);
    expect(r.status).toBe(201);
    expect(await gems()).toBe(100 - defaultConfig.economy.expertAdviceGems);
    const a = r.body.advice!;
    expect(a.tactics).toHaveLength(2);
    expect(a.training).toHaveLength(3);
    expect(a.surfaces).toHaveLength(3);
    expect(a.distance.min).toBeLessThanOrEqual(a.distance.best);
    // Not diagnosed: the hidden ceilings are not used.
    expect(r.body.diagnosed).toBe(false);
    expect(a.training.every((x) => x.headroom === null)).toBe(true);
    expect(a.history.byStrategy).toEqual([expect.objectContaining({ key: "CLOSER", runs: 1 })]);
    expect(a.history.bySurface).toHaveLength(1);
    // Buying again or reading it later costs nothing.
    await t.post(`${url()}/unlock`, {}, owner.token);
    expect((await t.get<ExpertAdviceDto>(url(), owner.token)).body.locked).toBe(false);
    expect(await gems()).toBe(100 - defaultConfig.economy.expertAdviceGems);
  });

  it("uses the ceilings once the horse is diagnosed", async () => {
    await t.db.query("UPDATE horses SET diagnosed_at = now() WHERE id = $1", [horse]);
    const a = (await t.get<ExpertAdviceDto>(url(), owner.token)).body;
    expect(a.diagnosed).toBe(true);
    expect(a.advice!.training.every((x) => typeof x.headroom === "number")).toBe(true);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
