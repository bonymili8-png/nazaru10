import type {
  HallOfFameDto,
  HorseSummaryDto,
  RaceDetailDto,
  RaceSummaryDto,
  SeasonDto,
  SeasonHorseRowDto,
  SeasonOwnerRowDto,
} from "@thoroughline/contracts";
import { defaultConfig, seasonAt, seasonPoints } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { SeasonsService } from "../src/modules/seasons/seasons.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };

describe("seasons", () => {
  let t: TestApp;
  let alice: User;
  let bob: User;
  let race: RaceDetailDto;

  const balances = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number; GEMS: number; PRESTIGE: number } }>("/wallet", u.token)).body
      .balances;

  beforeAll(async () => {
    t = await createTestApp();
    alice = await t.login(9001, "Alice");
    bob = await t.login(9002, "Bob");
  });
  afterAll(() => t.close());

  it("awards class-weighted points for a settled race", async () => {
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    const card = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN", alice.token)).body[0]!;
    for (const u of [alice, bob]) {
      const h = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!;
      expect(
        (await t.post(`/races/${card.id}/entries`, { horseId: h.id, strategy: "MID_PACK" }, u.token)).status,
      ).toBe(201);
    }
    t.clock.advance(new Date(card.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    await runner.runDue();
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
    race = (await t.get<RaceDetailDto>(`/races/${card.id}`, alice.token)).body;
    expect(race.status).toBe("COMPLETED");

    const season = seasonAt(new Date(race.startsAt), defaultConfig).season;
    const mine = race.entryList.filter((e) => !e.isHouse);
    const board = (
      await t.get<SeasonOwnerRowDto[]>(`/seasons/${season}/leaderboard?kind=owners`, alice.token)
    ).body;
    for (const e of mine) {
      const expected = seasonPoints(e.position!, "MAIDEN", defaultConfig);
      const rowFor = board.find((r) => r.name === e.ownerName);
      if (expected > 0) expect(rowFor?.points).toBe(expected);
    }
    // House horses never earn season points.
    const horses = (
      await t.get<SeasonHorseRowDto[]>(`/seasons/${season}/leaderboard?kind=horses`, alice.token)
    ).body;
    expect(horses.every((h) => mine.some((m) => m.horseId === h.horseId))).toBe(true);

    const current = (await t.get<SeasonDto>("/seasons/current", alice.token)).body;
    expect(current.season).toBe(season);
    expect(current.me.races).toBe(1);
  });

  it("closes the season once after the grace period, paying rewards and recording the Hall of Fame", async () => {
    const svc = t.service(SeasonsService);
    const season = seasonAt(new Date(race.startsAt), defaultConfig);
    expect(await svc.closeDue()).toBe(0);
    // A known Class 1 win (60 pts) makes Alice the deterministic leader regardless of the maiden result.
    const aliceHorse = (await t.get<HorseSummaryDto[]>("/horses", alice.token)).body[0]!;
    await t.db.tx((c) =>
      svc.award(c, { class: "CLASS_1", starts_at: new Date(race.startsAt) }, [
        { horseId: aliceHorse.id, ownerId: alice.userId, position: 1 },
      ]),
    );

    const board = (
      await t.get<SeasonOwnerRowDto[]>(`/seasons/${season.season}/leaderboard?kind=owners`, alice.token)
    ).body;
    const leader = board[0]!;
    expect(leader.userId).toBe(alice.userId);
    const leaderUser = alice;
    const before = await balances(leaderUser);

    t.clock.advance(season.endsAt.getTime() - t.clock.now().getTime() + 61 * 60_000);
    expect(await svc.closeDue()).toBe(1);
    expect(await svc.close(season.season)).toBe(false);

    const after = await balances(leaderUser);
    const reward = defaultConfig.seasons.rewards[0]!;
    expect(after.CREDITS - before.CREDITS).toBe(reward.credits);
    expect(after.PRESTIGE - before.PRESTIGE).toBe(reward.prestige);
    expect(after.GEMS - before.GEMS).toBe(reward.gems);

    const hof = (await t.get<HallOfFameDto[]>("/hall-of-fame", bob.token)).body;
    expect(hof.find((f) => f.category === "CHAMPION_OWNER")).toMatchObject({
      season: season.season,
      value: leader.points,
    });
    expect(hof.find((f) => f.category === "CHAMPION_HORSE")?.horseId).toBeTruthy();
    await expect(t.db.query("UPDATE hall_of_fame SET value = 0")).rejects.toThrow(/append-only/);

    const next = (await t.get<SeasonDto>("/seasons/current", alice.token)).body;
    expect(next.season).toBe(season.season + 1);
    expect(next.me).toMatchObject({ points: 0, rank: null });
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
