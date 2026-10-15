import type {
  HorseSummaryDto,
  RaceDetailDto,
  RaceSummaryDto,
  RaceTipsDto,
  TipsDto,
} from "@thoroughline/contracts";
import { defaultConfig, scoreTip, tipValues } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { TipsService } from "../src/modules/tips/tips.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type Err = { error?: { code: string } };

describe("tipster league", () => {
  let t: TestApp;
  let runner: RaceRunnerService;
  let tips: TipsService;
  let owner: { token: string; userId: string };
  let tipster: { token: string; userId: string };
  let horse: string;
  let race: RaceSummaryDto;
  let empty: RaceSummaryDto;
  const url = () => `/races/${race.id}/tips`;

  beforeAll(async () => {
    t = await createTestApp();
    runner = t.service(RaceRunnerService);
    tips = t.service(TipsService);
    owner = await t.login(9891, "Owner");
    tipster = await t.login(9892, "Tipster");
    horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!.id;
    await runner.scheduleAhead();
    const list = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=50", owner.token))
      .body;
    race = list[0]!;
    empty = list[1]!;
    expect(
      (await t.post(`/races/${race.id}/entries`, { horseId: horse, strategy: "CLOSER" }, owner.token)).status,
    ).toBe(201);
  });
  afterAll(() => t.close());

  it("races with players' horses are open for tips; each runner has a tip value", async () => {
    const r = (await t.get<RaceTipsDto>(url(), tipster.token)).body;
    expect(r).toMatchObject({ open: true, final: false, myTip: null, tipsters: 0, dailyLeft: 10 });
    expect(r.values.map((v) => v.horseId)).toEqual([horse]);
    expect((await t.get<RaceTipsDto>(`/races/${empty.id}/tips`, tipster.token)).body.open).toBe(false);
    expect(
      (await t.put<Err>(`/races/${empty.id}/tips`, { picks: [horse] }, tipster.token)).body.error!.code,
    ).toBe("TIPS_CLOSED");
  });

  it("picks must be different runners of the race", async () => {
    expect((await t.put(url(), { picks: [horse, horse] }, tipster.token)).status).toBe(400);
    expect(
      (await t.put<Err>(url(), { picks: ["00000000-0000-4000-8000-000000000000"] }, tipster.token)).body
        .error!.code,
    ).toBe("NOT_A_RUNNER");
    const r = await t.put<RaceTipsDto>(url(), { picks: [horse] }, tipster.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ myTip: { picks: [horse], points: null }, tipsters: 1, dailyLeft: 10 });
  });

  it("after entries close the full field can be tipped, until the off", async () => {
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    const field = (await t.get<RaceDetailDto>(`/races/${race.id}`, tipster.token)).body.entryList;
    expect(field.length).toBeGreaterThan(3);
    const picks = [horse, field.find((e) => e.isHouse)!.horseId, field.filter((e) => e.isHouse)[1]!.horseId];
    const r = (await t.put<RaceTipsDto>(url(), { picks }, tipster.token)).body;
    expect(r).toMatchObject({ final: true, myTip: { picks } });
    expect(r.values).toHaveLength(field.length);
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 500);
    await runner.runDue();
    expect((await t.put<Err>(url(), { picks: [horse] }, tipster.token)).body.error!.code).toBe("TIPS_CLOSED");
  });

  it("is scored when the race settles, by the published rules", async () => {
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
    expect(await tips.scoreDue()).toBe(1);
    const tip = (await t.get<RaceTipsDto>(url(), tipster.token)).body;
    const entries = (await t.get<RaceDetailDto>(`/races/${race.id}`, tipster.token)).body.entryList;
    const positions = new Map(entries.map((e) => [e.horseId, e.position!] as const));
    const values = tipValues(
      entries.map((e) => ({ id: e.horseId, strength: e.abilityRating })),
      defaultConfig,
    );
    expect(tip.myTip!.points).toBe(scoreTip(tip.myTip!.picks, positions, values, defaultConfig).points);
    const league = (await t.get<TipsDto>("/tips", tipster.token)).body;
    expect(league.me.tips).toBe(1);
    expect(league.myTips[0]).toMatchObject({ raceId: race.id, status: "SCORED", points: tip.myTip!.points });
    expect(league.myTips[0]!.picks).toHaveLength(3);
  });

  it("caps new tips per day", async () => {
    const others = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&limit=50", owner.token)).body.slice(
      0,
      10,
    );
    for (const r of others)
      await t.db.query(
        "INSERT INTO tips (user_id, race_id, picks, week, created_at, updated_at) VALUES ($1, $2, $3, current_date, $4, $4) ON CONFLICT DO NOTHING",
        [tipster.userId, r.id, [horse], t.clock.now()],
      );
    expect((await t.get<TipsDto>("/tips", tipster.token)).body.dailyLeft).toBe(0);
  });

  it("closes the week: the table is final and the top places are rewarded once", async () => {
    await t.db.query("UPDATE tips SET points = 25 WHERE user_id = $1 AND race_id = $2", [
      tipster.userId,
      race.id,
    ]);
    t.clock.advance(8 * 86_400_000);
    expect(await tips.closeWeeks()).toBeGreaterThanOrEqual(1);
    expect(await tips.closeWeeks()).toBe(0);
    const paid = await t.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ledger_transactions WHERE idempotency_key LIKE $1",
      [`tipster:%:${tipster.userId}:%`],
    );
    expect(paid[0]!.n).toBe(2); // gems and reputation for 1st place
    const league = (await t.get<TipsDto>("/tips", tipster.token)).body;
    expect(league.lastWeek[0]).toMatchObject({ userId: tipster.userId, rank: 1, points: 25, me: true });
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
