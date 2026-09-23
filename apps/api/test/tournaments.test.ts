import type {
  HorseSummaryDto,
  RaceDetailDto,
  RaceSummaryDto,
  TournamentDetailDto,
  TournamentDto,
} from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { TournamentsService } from "../src/modules/tournaments/tournaments.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string; horseId: string };

const HOUR = 3_600_000;

describe("tournaments", () => {
  let t: TestApp;
  let users: User[];
  let cup: TournamentDto;
  const local = defaultConfig.tournaments.tiers.LOCAL;

  const credits = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number; REPUTATION: number } }>("/wallet", u.token)).body.balances;
  const to = (iso: string, plusMs = 1000) =>
    t.clock.advance(new Date(iso).getTime() - t.clock.now().getTime() + plusMs);
  const runRacesUntil = async (iso: string) => {
    const runner = t.service(RaceRunnerService);
    to(iso);
    await runner.lockDue();
    await runner.runDue();
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
  };

  beforeAll(async () => {
    t = await createTestApp();
    // Move to 12 h before the next LOCAL heats slot, so registration is comfortably open.
    const step = local.everyHours * HOUR;
    const offset = local.offsetHours * HOUR;
    const now = t.clock.now().getTime();
    const at = Math.ceil((now + 12 * HOUR - offset) / step) * step + offset;
    t.clock.advance(at - 12 * HOUR - now);
    users = [];
    for (let i = 0; i < 7; i++) {
      const u = await t.login(9100 + i, `Owner${i}`);
      const h = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!;
      users.push({ ...u, horseId: h.id });
    }
  });
  afterAll(() => t.close());

  it("schedules tournaments per tier idempotently", async () => {
    const svc = t.service(TournamentsService);
    expect(await svc.scheduleAhead()).toBeGreaterThan(0);
    expect(await svc.scheduleAhead()).toBe(0);
    const list = (await t.get<TournamentDto[]>("/tournaments", users[0]!.token)).body;
    cup = list.find((x) => x.tier === "LOCAL" && x.status === "REGISTRATION")!;
    expect(cup).toBeTruthy();
    expect(cup).toMatchObject({ entryFee: local.entryFee, purse: local.purse, entrants: 0 });
  });

  it("registers horses, charging the fee and committing the horse", async () => {
    const [a] = users;
    const before = (await credits(a!)).CREDITS;
    const res = await t.post<TournamentDetailDto>(
      `/tournaments/${cup.id}/entries`,
      { horseId: a!.horseId, strategy: "MID_PACK" },
      a!.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.myEntries).toHaveLength(1);
    expect((await credits(a!)).CREDITS).toBe(before - local.entryFee);
    // Committed: cannot train or register twice.
    const again = await t.post(
      `/tournaments/${cup.id}/entries`,
      { horseId: a!.horseId, strategy: "CLOSER" },
      a!.token,
    );
    expect(again.status).toBe(409);
    const train = await t.post(
      `/horses/${a!.horseId}/training`,
      { type: "SPEED", intensity: "LIGHT" },
      a!.token,
    );
    expect(train.status).toBe(409);

    // Withdraw refunds; re-registering charges again under a fresh idempotency key.
    const w = await t.del<TournamentDetailDto>(`/tournaments/${cup.id}/entries/${a!.horseId}`, a!.token);
    expect(w.status).toBe(200);
    expect((await credits(a!)).CREDITS).toBe(before);
    for (const u of users) {
      const r = await t.post(
        `/tournaments/${cup.id}/entries`,
        { horseId: u.horseId, strategy: "MID_PACK" },
        u.token,
      );
      expect(r.status).toBe(201);
    }
    expect((await credits(a!)).CREDITS).toBe(before - local.entryFee);
    const d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, a!.token)).body;
    expect(d.entrants).toBe(7);
    expect(d.entries.filter((e) => e.mine)).toHaveLength(1);
  });

  it("enforces qualification for higher tiers", async () => {
    // A qualifying-only copy of the open cup (deterministic regardless of the tier cycle).
    const higher = (
      await t.db.query<{ id: string }>(
        `INSERT INTO tournaments (name, tier, race_class, track_code, distance, entry_fee, purse, min_season_points,
                                  min_rating, max_entrants, players_per_heat, qualifiers_per_heat, opens_at,
                                  registration_closes_at, heats_at, final_at)
         SELECT 'Qualifier test', 'ELITE', race_class, track_code, distance, entry_fee, purse, 1000, 5000,
                max_entrants, players_per_heat, qualifiers_per_heat, opens_at, registration_closes_at,
                heats_at + interval '1 minute', final_at
           FROM tournaments WHERE id = $1 RETURNING id`,
        [cup.id],
      )
    )[0]!;
    const u = await t.login(9200, "Rookie");
    const h = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!;
    const r = await t.post<{ error: { code: string } }>(
      `/tournaments/${higher.id}/entries`,
      { horseId: h.id, strategy: "MID_PACK" },
      u.token,
    );
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain("NOT_QUALIFIED");
  });

  it("draws seeded heats that cannot be entered directly", async () => {
    const svc = t.service(TournamentsService);
    to(cup.registrationClosesAt);
    expect(await svc.advanceDue()).toBeGreaterThanOrEqual(1);
    const d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, users[0]!.token)).body;
    expect(d.status).toBe("HEATS");
    expect(d.heatRaceIds).toHaveLength(2);
    expect(d.entries.every((e) => e.status === "IN_HEAT" && e.heatRaceId)).toBe(true);
    const sizes = d.heatRaceIds.map((id) => d.entries.filter((e) => e.heatRaceId === id).length);
    expect(sizes.sort()).toEqual([3, 4]);

    const heat = (await t.get<RaceDetailDto>(`/races/${d.heatRaceIds[0]}`, users[0]!.token)).body;
    expect(heat).toMatchObject({ tournamentId: cup.id, entryFee: 0, purse: 0 });
    const outsider = await t.login(9300, "Outsider");
    const oh = (await t.get<HorseSummaryDto[]>("/horses", outsider.token)).body[0]!;
    const direct = await t.post(
      `/races/${heat.id}/entries`,
      { horseId: oh.id, strategy: "MID_PACK" },
      outsider.token,
    );
    expect(direct.status).toBe(409);
    const upcoming = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&limit=50", outsider.token)).body;
    expect(upcoming.some((r) => r.tournamentId)).toBe(false);
  });

  it("runs heats, sends the top finishers to the final and crowns a champion", async () => {
    const svc = t.service(TournamentsService);
    let d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, users[0]!.token)).body;
    const lastHeat = (await t.get<RaceDetailDto>(`/races/${d.heatRaceIds[1]}`, users[0]!.token)).body;
    await runRacesUntil(lastHeat.startsAt);
    for (const id of d.heatRaceIds)
      expect((await t.get<RaceDetailDto>(`/races/${id}`, users[0]!.token)).body.status).toBe("COMPLETED");
    expect(await svc.advanceDue()).toBe(1);

    d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, users[0]!.token)).body;
    expect(d.status).toBe("FINAL");
    const finalists = d.entries.filter((e) => e.status === "FINALIST");
    const eliminated = d.entries.filter((e) => e.status === "ELIMINATED");
    const scratched = d.entries.filter((e) => e.status === "SCRATCHED");
    expect(finalists.length + scratched.length).toBe(4);
    expect(eliminated).toHaveLength(3);
    for (const e of finalists) expect(e.heatPosition).not.toBeNull();
    const final = (await t.get<RaceDetailDto>(`/races/${d.finalRaceId}`, users[0]!.token)).body;
    expect(final).toMatchObject({ purse: local.purse, tournamentId: cup.id });
    expect(final.entryList.filter((e) => !e.isHouse)).toHaveLength(finalists.length);

    const before = new Map(await Promise.all(users.map(async (u) => [u.userId, await credits(u)] as const)));
    await runRacesUntil(d.finalAt);
    expect(await svc.advanceDue()).toBe(1);
    expect(await svc.advanceDue()).toBe(0);

    d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, users[0]!.token)).body;
    expect(d.status).toBe("COMPLETED");
    const champ = d.entries.find((e) => e.finalPosition !== null)!;
    expect(d.winner?.horseId).toBe(champ.horseId);
    const champOwner = users.find((u) => u.horseId === champ.horseId)!;
    const after = await credits(champOwner);
    expect(after.REPUTATION - before.get(champOwner.userId)!.REPUTATION).toBeGreaterThanOrEqual(
      local.championReputation,
    );
    // Horses are released after the final.
    const h = (await t.get<HorseSummaryDto[]>("/horses", champOwner.token)).body[0]!;
    expect(["IDLE", "INJURED"]).toContain(h.status);
  });

  it("cancels an under-subscribed tournament and refunds", async () => {
    const svc = t.service(TournamentsService);
    await svc.scheduleAhead();
    const list = (await t.get<TournamentDto[]>("/tournaments", users[0]!.token)).body;
    const next = list.find((x) => x.tier === "LOCAL" && x.status === "REGISTRATION")!;
    expect(next.id).not.toBe(cup.id);
    const fresh = await t.login(9400, "Latecomer");
    const horse = (await t.get<HorseSummaryDto[]>("/horses", fresh.token)).body[0]!;
    const u = { ...fresh, horseId: horse.id };
    const before = (await credits(u)).CREDITS;
    const r = await t.post(
      `/tournaments/${next.id}/entries`,
      { horseId: horse.id, strategy: "CLOSER" },
      u.token,
    );
    expect(r.status).toBe(201);
    to(next.registrationClosesAt);
    await svc.advanceDue();
    const d = (await t.get<TournamentDetailDto>(`/tournaments/${next.id}`, u.token)).body;
    expect(d.status).toBe("CANCELLED");
    expect((await credits(u)).CREDITS).toBe(before);
    const again = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body.find((h) => h.id === horse.id)!;
    expect(again.status).toBe("IDLE");
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
