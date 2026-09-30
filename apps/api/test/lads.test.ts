import type { HorseDetailDto, HorseSummaryDto, StableLadsDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { LadsService } from "../src/modules/horses/lads.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("stable lads", () => {
  let t: TestApp;
  let lads: LadsService;
  let owner: { token: string; userId: string };
  let horseId: string;
  const gems = async () =>
    (await t.get<{ balances: { GEMS: number } }>("/wallet", owner.token)).body.balances.GEMS;
  const hire = (n: number) =>
    t.post<StableLadsDto & { error?: { code: string } }>("/stable/lads", { lads: n }, owner.token);
  const care = async () =>
    (await t.get<HorseDetailDto>(`/horses/${horseId}`, owner.token)).body.private!.care;

  beforeAll(async () => {
    t = await createTestApp();
    lads = t.service(LadsService);
    owner = await t.login(9841, "Squire");
    horseId = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("offers lads by the week for gems, one per five horses", async () => {
    const d = (await t.get<StableLadsDto>("/stable/lads", owner.token)).body;
    expect(d).toMatchObject({ lads: 0, horses: 1, needed: 1, covered: 0, gemsPerLadWeek: 50, maxLads: 2 });
    expect((await hire(1)).status).toBe(409); // no gems yet
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount: 300,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:squire",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
  });

  it("a hired lad starts the round at once", async () => {
    const res = await hire(1);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ lads: 1, covered: 1 });
    expect(res.body.lastWorkJobs).toBeGreaterThanOrEqual(2);
    expect(await gems()).toBe(250);
    const c = await care();
    expect(c.bond).toBeGreaterThan(0);
    expect(c.actions.find((a) => a.action === "GROOM")!.ready).toBe(false);
    // Fresh shoes: the lad does not call the farrier for nothing.
    expect(c.shoeStarts).toBe(0);
  });

  it("goes round again as jobs come due, not before", async () => {
    expect(await lads.runDue()).toBe(0);
    t.clock.advance(8 * 3_600_000);
    expect(await lads.runDue()).toBeGreaterThanOrEqual(2); // groom and walk again
    expect(await lads.runDue()).toBe(0);
  });

  it("adds a second lad pro rata, extends a week, never downgrades mid-contract", async () => {
    const before = await gems();
    const up = await hire(2);
    expect(up.status).toBe(201);
    const paid = before - (await gems());
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(50);
    expect(up.body.upgradeGems).toBeNull();
    const until = up.body.paidUntil!;
    const ext = await hire(2);
    expect(new Date(ext.body.paidUntil!).getTime() - new Date(until).getTime()).toBe(7 * 86_400_000);
    expect((await hire(1)).body.error!.code).toBe("LADS_UNDER_CONTRACT");
    expect((await hire(3)).status).toBe(400);
  });

  it("stop working once the paid time runs out", async () => {
    t.clock.advance(15 * 86_400_000);
    expect(await lads.runDue()).toBe(0);
    expect((await t.get<StableLadsDto>("/stable/lads", owner.token)).body.lads).toBe(0);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
