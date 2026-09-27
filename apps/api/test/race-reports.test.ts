import type { HorseSummaryDto, RaceReportDto, RaceSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("race reports", () => {
  let t: TestApp;
  let owner: { token: string; userId: string };
  let member: { token: string; userId: string };
  let rival: { token: string; userId: string };
  let race: RaceSummaryDto;
  let horse: string;
  let memberHorse: string;
  const gems = async () =>
    (await t.get<{ balances: { GEMS: number } }>("/wallet", owner.token)).body.balances.GEMS;
  const url = (h = horse) => `/races/${race.id}/report/${h}`;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(4401, "Analyst");
    member = await t.login(4402, "Insider");
    rival = await t.login(4403, "Rival");
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=5", owner.token))
      .body[0]!;
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
    memberHorse = (await t.get<HorseSummaryDto[]>("/horses", member.token)).body[0]!.id;
    await t.post(`/races/${race.id}/entries`, { horseId: horse, strategy: "CLOSER" }, owner.token);
    await t.post(`/races/${race.id}/entries`, { horseId: memberHorse, strategy: "MID_PACK" }, member.token);
    await t.db.query(
      `INSERT INTO subscriptions (user_id, product_id, status, period_end, charge_id)
       VALUES ($1, 'OWNERS_CIRCLE', 'ACTIVE', $2, 'test-charge')`,
      [member.userId, new Date(t.clock.now().getTime() + 30 * 86_400_000)],
    );
  });
  afterAll(() => t.close());

  it("is not available before the result is official", async () => {
    const runner = t.service(RaceRunnerService);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    expect((await t.get(url())).status).toBe(401);
    expect((await t.get<{ error: { code: string } }>(url(), owner.token)).body.error.code).toBe(
      "RESULTS_PENDING",
    );
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.runDue();
    const pending = await t.get<{ error: { code: string } }>(url(), owner.token);
    expect(pending.body.error.code).toBe("RESULTS_PENDING");
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
  });

  it("is locked for a non-member until bought, and private to the owner", async () => {
    const r = await t.get<RaceReportDto>(url(), owner.token);
    expect(r.body).toMatchObject({ locked: true, priceGems: 10, member: false, report: null });
    expect((await t.get(url(), rival.token)).status).toBe(404);
    const broke = await t.post<{ error: { code: string } }>(`${url()}/unlock`, {}, owner.token);
    expect(broke.body.error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("unlocks once for gems and explains the run", async () => {
    await t.db.tx((c) =>
      t.service(LedgerService).credit(c, {
        userId: owner.userId,
        currency: "GEMS",
        amount: 15,
        source: "ADMIN_ADJUSTMENT",
        key: "test:gems:analyst",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    const r = await t.post<RaceReportDto>(`${url()}/unlock`, {}, owner.token);
    expect(r.status).toBe(201);
    expect(r.body.locked).toBe(false);
    const rep = r.body.report!;
    expect(rep.positions).toHaveLength(4);
    expect(rep.sectionals).toHaveLength(4);
    expect(rep.strategy).toBe("CLOSER");
    expect(rep.topSpeed).toBeGreaterThan(10);
    expect(await gems()).toBe(5);
    // Buying again or reading it later costs nothing.
    await t.post(`${url()}/unlock`, {}, owner.token);
    expect((await t.get<RaceReportDto>(url(), owner.token)).body.locked).toBe(false);
    expect(await gems()).toBe(5);
  });

  it("is free for Owners' Circle members", async () => {
    const r = await t.get<RaceReportDto>(url(memberHorse), member.token);
    expect(r.body).toMatchObject({ locked: false, member: true });
    expect(r.body.report!.strategy).toBe("MID_PACK");
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
