import type {
  AdminSwitchDto,
  HorseSummaryDto,
  RaceDetailDto,
  TournamentDetailDto,
  TournamentDto,
} from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { TournamentsService } from "../src/modules/tournaments/tournaments.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

const HOUR = 3_600_000;

describe("tournaments filled with house horses (admin switch)", () => {
  let t: TestApp;
  let admin: { token: string; userId: string };
  let solo: { token: string; userId: string; horseId: string };
  const local = defaultConfig.tournaments.tiers.LOCAL;
  const field = defaultConfig.race.schedule.targetField;

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
  const nextLocal = async (token: string) => {
    await t.service(TournamentsService).scheduleAhead();
    const list = (await t.get<TournamentDto[]>("/tournaments", token)).body;
    return list
      .filter((x) => x.tier === "LOCAL" && x.status === "REGISTRATION")
      .sort((a, b) => a.heatsAt.localeCompare(b.heatsAt))[0]!;
  };
  const enter = (u: { token: string; horseId: string }, id: string) =>
    t.post(`/tournaments/${id}/entries`, { horseId: u.horseId, strategy: "MID_PACK" }, u.token);
  const toggle = (enabled: boolean, token = admin.token) =>
    t.post<AdminSwitchDto>("/admin/tournament-house-fill", { enabled, note: "test switch" }, token);

  beforeAll(async () => {
    t = await createTestApp();
    const step = local.everyHours * HOUR;
    const offset = local.offsetHours * HOUR;
    const now = t.clock.now().getTime();
    const at = Math.ceil((now + 12 * HOUR - offset) / step) * step + offset;
    t.clock.advance(at - 12 * HOUR - now);
    admin = await t.login(9501, "Steward");
    await t.db.query("UPDATE users SET role = 'TOURNAMENT_ADMIN' WHERE id = $1", [admin.userId]);
    const u = await t.login(9502, "Lonely");
    solo = { ...u, horseId: (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id };
  });
  afterAll(() => t.close());

  it("is on by default, and only the tournament team sees and flips the switch", async () => {
    expect((await t.get("/admin/tournament-house-fill", solo.token)).status).toBe(403);
    expect((await toggle(false, solo.token)).status).toBe(403);
    const v = (await t.get<AdminSwitchDto>("/admin/tournament-house-fill", admin.token)).body;
    expect(v).toEqual({ enabled: true, history: [] });
  });

  it("runs a cup with a single entrant: straight to a final with a full house field", async () => {
    const cup = await nextLocal(solo.token);
    expect(cup.houseFill).toBe(true);
    expect((await enter(solo, cup.id)).status).toBe(201);
    to(cup.registrationClosesAt);
    await t.service(TournamentsService).advanceDue();
    let d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, solo.token)).body;
    expect(d).toMatchObject({ status: "FINAL", houseFill: true, heatRaceIds: [] });

    // Even now that the switch is off, the drawn cup keeps its rules.
    expect((await toggle(false)).body.enabled).toBe(false);
    await runRacesUntil(d.finalAt);
    const final = (await t.get<RaceDetailDto>(`/races/${d.finalRaceId}`, solo.token)).body;
    expect(final.entryList).toHaveLength(field);
    expect(final.entryList.filter((e) => e.isHouse)).toHaveLength(field - 1);
    await t.service(TournamentsService).advanceDue();

    d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, solo.token)).body;
    expect(d.status).toBe("COMPLETED");
    // The final's winner is champion, house horse or not.
    const winner =
      final.entryList.find((e) => e.position === 1) ??
      (await t.get<RaceDetailDto>(`/races/${d.finalRaceId}`, solo.token)).body.entryList.find(
        (e) => e.position === 1,
      )!;
    expect(d.winner!.horseId).toBe(winner.horseId);
    expect(d.winner!.house).toBe(winner.isHouse);
    const mine = d.standings[0]!;
    expect(mine.finalPosition).not.toBeNull();
    expect(mine.rank).toBe(mine.finalPosition);
    expect(mine.champion).toBe(!winner.isHouse);
    const result = await t.db.one<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM domain_events WHERE type = 'tournament_result' AND aggregate_id = $1",
      [cup.id],
    );
    expect(result!.payload).toMatchObject({ finalists: field, championHouse: winner.isHouse });
    const final2 = (await t.get<RaceDetailDto>(`/races/${d.finalRaceId}`, solo.token)).body;
    expect(final2.entryList.filter((e) => e.isHouse)).toHaveLength(field - 1);
  });

  it("switched off: a lone entrant's cup is called off and refunded", async () => {
    const cup = await nextLocal(solo.token);
    expect(cup.houseFill).toBe(false);
    const r = await enter(solo, cup.id);
    expect(r.status).toBe(201);
    to(cup.registrationClosesAt);
    await t.service(TournamentsService).advanceDue();
    const d = (await t.get<TournamentDetailDto>(`/tournaments/${cup.id}`, solo.token)).body;
    expect(d).toMatchObject({ status: "CANCELLED", cancelReason: "Not enough entrants", houseFill: false });
  });

  it("keeps an audited history of the switch", async () => {
    expect((await toggle(true)).body.enabled).toBe(true);
    const v = (await t.get<AdminSwitchDto>("/admin/tournament-house-fill", admin.token)).body;
    expect(v.history.map((h) => h.enabled)).toEqual([true, false]);
    expect(v.history[0]!.note).toBe("test switch");
    const audit = await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'TOURNAMENT_HOUSE_FILL_SWITCH'");
    expect(audit).toHaveLength(2);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
