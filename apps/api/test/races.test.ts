import type { HorseSummaryDto, LiveRaceDto, RaceDetailDto, RaceSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

describe("race lifecycle", () => {
  let t: TestApp;
  let runner: RaceRunnerService;
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };
  let aliceHorse: string;
  let bobHorse: string;
  let race: RaceSummaryDto;

  beforeAll(async () => {
    t = await createTestApp();
    runner = t.service(RaceRunnerService);
    alice = await t.login(4001, "Alice");
    bob = await t.login(4002, "Bob");
    aliceHorse = (await t.get<HorseSummaryDto[]>("/horses", alice.token)).body[0]!.id;
    bobHorse = (await t.get<HorseSummaryDto[]>("/horses", bob.token)).body[0]!.id;
  });
  afterAll(() => t.close());

  it("schedules the race card idempotently", async () => {
    const n = await runner.scheduleAhead();
    expect(n).toBeGreaterThan(10);
    expect(await runner.scheduleAhead()).toBe(0);
    const list = await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=50", alice.token);
    expect(list.body.length).toBeGreaterThan(3);
    expect(
      list.body.every((r) => r.class === "MAIDEN" && r.status === "OPEN" && r.seedHash.length === 32),
    ).toBe(true);
    race = list.body[0]!;
  });

  it("enters horses, charging the fee once and blocking double entry", async () => {
    const res = await t.post<RaceDetailDto>(
      `/races/${race.id}/entries`,
      { horseId: aliceHorse, strategy: "CLOSER" },
      alice.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.entryList).toHaveLength(1);
    expect(res.body.entryList[0]).toMatchObject({ mine: true, strategy: "CLOSER" });
    const dup = await t.post<{ error: { code: string } }>(
      `/races/${race.id}/entries`,
      { horseId: aliceHorse, strategy: "CLOSER" },
      alice.token,
    );
    expect(dup.status).toBe(409);
    const other = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=50", alice.token))
      .body[1]!;
    expect(
      (await t.post(`/races/${other.id}/entries`, { horseId: aliceHorse, strategy: "CLOSER" }, alice.token))
        .status,
    ).toBe(409);
    expect(
      (await t.post(`/races/${race.id}/entries`, { horseId: aliceHorse, strategy: "CLOSER" }, bob.token))
        .status,
    ).toBe(403);
    const wallet = await t.get<{ balances: { CREDITS: number } }>("/wallet", alice.token);
    expect(wallet.body.balances.CREDITS).toBe(5000 - race.entryFee);
  });

  it("withdraws with a refund before the lock", async () => {
    const res = await t.post<RaceDetailDto>(
      `/races/${race.id}/entries`,
      { horseId: bobHorse, strategy: "FRONT_RUNNER" },
      bob.token,
    );
    expect(res.status).toBe(201);
    // Bob's tactics are hidden from Alice.
    const seen = await t.get<RaceDetailDto>(`/races/${race.id}`, alice.token);
    expect(seen.body.entryList.find((e) => e.horseId === bobHorse)!.strategy).toBeNull();
    expect((await t.del(`/races/${race.id}/entries/${bobHorse}`, bob.token)).status).toBe(200);
    const wallet = await t.get<{ balances: { CREDITS: number } }>("/wallet", bob.token);
    expect(wallet.body.balances.CREDITS).toBe(5000);
    expect((await t.get<HorseSummaryDto[]>("/horses", bob.token)).body[0]!.status).toBe("IDLE");
  });

  it("locks: fills the field with house horses, draws gates, closes entries", async () => {
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    expect(await runner.lockDue()).toBeGreaterThan(0);
    const d = await t.get<RaceDetailDto>(`/races/${race.id}`, alice.token);
    expect(d.body.status).toBe("LOCKED");
    expect(d.body.entryList).toHaveLength(8);
    expect(new Set(d.body.entryList.map((e) => e.gate)).size).toBe(8);
    expect(d.body.entryList.every((e) => e.jockeyName)).toBe(true);
    expect(
      (await t.post(`/races/${race.id}/entries`, { horseId: bobHorse, strategy: "CLOSER" }, bob.token))
        .status,
    ).toBe(409);
    expect((await t.del(`/races/${race.id}/entries/${aliceHorse}`, alice.token)).status).toBe(409);
    // Every due race was processed; due races nobody entered are skipped, not run.
    const now = t.clock.now();
    const open = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM races WHERE status = 'OPEN' AND locks_at <= $1",
      [now],
    );
    expect(open!.n).toBe(0);
    const empties = await t.db.query<{ status: string }>(
      `SELECT status FROM races r WHERE locks_at <= $1 AND NOT EXISTS
         (SELECT 1 FROM race_entries e WHERE e.race_id = r.id AND NOT e.is_house)`,
      [now],
    );
    expect(empties.every((r) => r.status === "CANCELLED")).toBe(true);
  });

  it("runs, streams the race live without spoilers, then settles once", async () => {
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 500);
    expect(await runner.runDue()).toBe(1);
    expect(await runner.runDue()).toBe(0);
    t.clock.advance(10_000);
    const live = await t.get<LiveRaceDto>(`/races/${race.id}/live`, bob.token);
    expect(live.body.status).toBe("RUNNING");
    expect(live.body.results).toBeNull();
    expect(live.body.frames!.data.length).toBeLessThanOrEqual(12);
    expect(live.body.commentary.every((l) => l.t <= live.body.elapsed)).toBe(true);
    const detail = await t.get<RaceDetailDto>(`/races/${race.id}`, bob.token);
    expect(detail.body.entryList.every((e) => e.position === null)).toBe(true);
    expect(await runner.settleDue()).toBe(0); // not before the broadcast ends

    t.clock.advance(5 * 60_000);
    expect(await runner.settleDue()).toBe(1);
    expect(await runner.settleDue()).toBe(0);
    const final = await t.get<LiveRaceDto>(`/races/${race.id}/live`, alice.token);
    expect(final.body.status).toBe("COMPLETED");
    expect(final.body.results).toHaveLength(8);
    const done = await t.get<RaceDetailDto>(`/races/${race.id}`, alice.token);
    expect(done.body.seed).toBeTruthy();
    const mine = done.body.entryList.find((e) => e.mine)!;
    expect(mine.position).toBeGreaterThanOrEqual(1);

    const horse = await t.db.one<{ starts: number; earnings: number; status: string; fatigue: number }>(
      "SELECT starts, earnings, status, fatigue FROM horses WHERE id = $1",
      [aliceHorse],
    );
    expect(horse!.starts).toBe(1);
    expect(horse!.earnings).toBe(mine.prize);
    expect(["IDLE", "INJURED"]).toContain(horse!.status);
    const wallet = await t.get<{ balances: { CREDITS: number } }>("/wallet", alice.token);
    expect(wallet.body.balances.CREDITS).toBe(5000 - race.entryFee + (mine.prize ?? 0));
    const quests = await t.get<{ code: string; completed: boolean }[]>("/quests", alice.token);
    expect(quests.body.find((q) => q.code === "FIRST_RACE")!.completed).toBe(true);
  });

  it("verifies the commit–reveal seed", async () => {
    const { seedHash } = await import("@thoroughline/engine");
    const done = await t.get<RaceDetailDto>(`/races/${race.id}`, alice.token);
    expect(seedHash(done.body.seed!)).toBe(done.body.seedHash);
  });

  it("re-running any lifecycle step is a no-op", async () => {
    expect(await runner.lock(race.id)).toBe(false);
    expect(await runner.run(race.id)).toBe(false);
    expect(await runner.settle(race.id)).toBe(false);
    const prizes = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM ledger_transactions WHERE idempotency_key LIKE $1",
      [`race:${race.id}:prize:%`],
    );
    expect(prizes!.n).toBeLessThanOrEqual(1);
  });

  it("shows up on the leaderboards", async () => {
    const board = await t.get<{ horseId: string }[]>("/leaderboard/horses?by=rating", alice.token);
    expect(board.body.map((b) => b.horseId)).toContain(aliceHorse);
    expect((await t.get("/leaderboard/owners?by=earnings", alice.token)).status).toBe(200);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
