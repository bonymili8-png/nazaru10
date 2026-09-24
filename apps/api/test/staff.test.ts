import type {
  HorseSummaryDto,
  JockeyDto,
  RaceDetailDto,
  RaceSummaryDto,
  StaffDto,
  TrainerDto,
  TrainingSessionDto,
} from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/modules/economy/ledger.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { StaffService } from "../src/modules/staff/staff.service.js";
import { TrainingService } from "../src/modules/training/training.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };
const DAY = 86_400_000;

describe("staff", () => {
  let t: TestApp;
  let alice: User;
  let bob: User;
  let pool: TrainerDto[];

  const credits = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", u.token)).body.balances.CREDITS;

  beforeAll(async () => {
    t = await createTestApp();
    alice = await t.login(9501, "Alice");
    bob = await t.login(9502, "Bob");
  });
  afterAll(() => t.close());

  it("keeps a hiring pool of trainers", async () => {
    const svc = t.service(StaffService);
    expect(await svc.restock()).toBe(defaultConfig.staff.poolSize);
    expect(await svc.restock()).toBe(0);
    pool = (await t.get<TrainerDto[]>("/staff/trainers", alice.token)).body;
    expect(pool).toHaveLength(defaultConfig.staff.poolSize);
    expect(pool[0]!.skill).toBeGreaterThanOrEqual(pool.at(-1)!.skill);
    expect(pool[0]!.effect.gainPct).toBeGreaterThanOrEqual(0);
  });

  it("hires with a week of salary in advance and enforces the stable limit", async () => {
    const cheapest = [...pool].sort((a, b) => a.salary - b.salary);
    const before = await credits(alice);
    const res = await t.post<StaffDto>("/staff/contracts", { trainerId: cheapest[0]!.id }, alice.token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ maxTrainers: 1, weeklyCost: cheapest[0]!.salary });
    expect(await credits(alice)).toBe(before - cheapest[0]!.salary);

    const second = await t.post("/staff/contracts", { trainerId: cheapest[1]!.id }, alice.token);
    expect(second.status).toBe(409);
    const taken = await t.post("/staff/contracts", { trainerId: cheapest[0]!.id }, bob.token);
    expect(taken.status).toBe(409);
    const left = (await t.get<TrainerDto[]>("/staff/trainers", bob.token)).body;
    expect(left.some((x) => x.id === cheapest[0]!.id)).toBe(false);
  });

  it("lets exactly one stable win a race for the same trainer", async () => {
    const carol = await t.login(9503, "Carol");
    const target = (await t.get<TrainerDto[]>("/staff/trainers", bob.token)).body[0]!;
    const results = await Promise.all(
      [bob, carol].map((u) => t.post("/staff/contracts", { trainerId: target.id }, u.token)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const hires = await t.db.query("SELECT 1 FROM staff_contracts WHERE trainer_id = $1", [target.id]);
    expect(hires).toHaveLength(1);
  });

  it("snapshots the supervising trainer on training sessions", async () => {
    const horse = (await t.get<HorseSummaryDto[]>("/horses", alice.token)).body[0]!;
    const res = await t.post<TrainingSessionDto>(
      `/horses/${horse.id}/training`,
      { type: "STAMINA", intensity: "LIGHT" },
      alice.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.trainer?.name).toBeTruthy();
    expect(res.body.trainer!.gainMultiplier).toBeGreaterThanOrEqual(1);
    t.clock.advance(3 * 3_600_000);
    await t.service(TrainingService).settleAllDue();
    const row = await t.db.one<{ result: { factors: unknown } }>(
      "SELECT result FROM training_sessions WHERE id = $1",
      [res.body.id],
    );
    expect(row?.result).toBeTruthy();
  });

  it("renews weekly and lets an unpaid trainer go", async () => {
    const svc = t.service(StaffService);
    const mine = (await t.get<StaffDto>("/staff", alice.token)).body.contracts[0]!;
    t.clock.advance(new Date(mine.paidUntil).getTime() - t.clock.now().getTime() + 1000);
    const before = await credits(alice);
    expect(await svc.renewDue()).toBeGreaterThanOrEqual(1);
    expect(await svc.renewDue()).toBe(0);
    const renewed = (await t.get<StaffDto>("/staff", alice.token)).body.contracts[0]!;
    expect(renewed.periods).toBe(2);
    expect(new Date(renewed.paidUntil).getTime()).toBe(new Date(mine.paidUntil).getTime() + 7 * DAY);
    expect(await credits(alice)).toBe(before - mine.salary);

    // Drain Alice's wallet below the salary: the next renewal ends the contract.
    const balance = await credits(alice);
    await t.db.tx((c) =>
      t.service(LedgerService).debit(c, {
        userId: alice.userId,
        currency: "CREDITS",
        amount: balance - (mine.salary - 1),
        sink: "ADMIN_ADJUSTMENT",
        key: "test:drain:alice",
        type: "ADMIN_ADJUSTMENT",
      }),
    );
    t.clock.advance(7 * DAY + 1000);
    await svc.renewDue();
    expect((await t.get<StaffDto>("/staff", alice.token)).body.contracts).toHaveLength(0);
    expect(await credits(alice)).toBe(mine.salary - 1);
    const ev = await t.db.query("SELECT 1 FROM domain_events WHERE type = 'trainer_left'");
    expect(ev).toHaveLength(1);
    // Back in the pool.
    const back = (await t.get<TrainerDto[]>("/staff/trainers", bob.token)).body;
    expect(back.some((x) => x.id === mine.trainer.id)).toBe(true);
  });

  it("dismisses immediately without a refund", async () => {
    const staff = (await t.get<StaffDto>("/staff", bob.token)).body;
    const k = staff.contracts[0]!;
    const before = await credits(bob);
    const res = await t.del<StaffDto>(`/staff/contracts/${k.id}`, bob.token);
    expect(res.status).toBe(200);
    expect(res.body.contracts).toHaveLength(0);
    expect(await credits(bob)).toBe(before);
    expect((await t.del(`/staff/contracts/${k.id}`, bob.token)).status).toBe(404);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});

describe("retained jockeys", () => {
  let t: TestApp;
  let owner: User;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.login(9601, "Jockeyed");
  });
  afterAll(() => t.close());

  it("retains a freelance jockey who then rides the owner's horse", async () => {
    const svc = t.service(StaffService);
    expect(await svc.restockJockeys()).toBe(defaultConfig.staff.jockeys.poolSize);
    const pool = (await t.get<JockeyDto[]>("/staff/jockeys", owner.token)).body;
    expect(pool).toHaveLength(defaultConfig.staff.jockeys.poolSize);
    const pick = [...pool].sort((a, b) => a.salary - b.salary)[0]!;
    const before = (await t.get<{ balances: { CREDITS: number } }>("/wallet", owner.token)).body.balances
      .CREDITS;
    const hired = await t.post<StaffDto>("/staff/jockey-contracts", { jockeyId: pick.id }, owner.token);
    expect(hired.status).toBe(201);
    expect(hired.body).toMatchObject({ maxJockeys: 1, weeklyCost: pick.salary });
    expect(hired.body.jockeys[0]!.jockey.id).toBe(pick.id);
    expect(
      (await t.get<{ balances: { CREDITS: number } }>("/wallet", owner.token)).body.balances.CREDITS,
    ).toBe(before - pick.salary);
    expect((await t.post("/staff/jockey-contracts", { jockeyId: pool[1]!.id }, owner.token)).status).toBe(
      409,
    );
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN", owner.token)).body[0]!;
    const horse = (await t.get<HorseSummaryDto[]>("/horses", owner.token)).body[0]!;
    expect(
      (await t.post(`/races/${race.id}/entries`, { horseId: horse.id, strategy: "MID_PACK" }, owner.token))
        .status,
    ).toBe(201);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    const detail = (await t.get<RaceDetailDto>(`/races/${race.id}`, owner.token)).body;
    const mine = detail.entryList.find((e) => e.mine)!;
    expect(mine.jockeyName).toBe(pick.name);
    // Nobody else in the field rides with the retained jockey.
    expect(detail.entryList.filter((e) => e.jockeyName === pick.name)).toHaveLength(1);
  });

  it("dismissing a jockey returns them to the pool", async () => {
    const k = (await t.get<StaffDto>("/staff", owner.token)).body.jockeys[0]!;
    expect((await t.del(`/staff/contracts/${k.id}`, owner.token)).status).toBe(200);
    const pool = (await t.get<JockeyDto[]>("/staff/jockeys", owner.token)).body;
    expect(pool.some((j) => j.id === k.jockey.id)).toBe(true);
    // House jockeys are not for hire.
    const house = await t.db.one<{ id: string }>("SELECT id FROM jockeys WHERE is_house LIMIT 1");
    expect((await t.post("/staff/jockey-contracts", { jockeyId: house!.id }, owner.token)).status).toBe(404);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
