import type { HorseSummaryDto, ShowdownDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShowdownsService } from "../src/modules/showdowns/showdowns.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type Err = { error?: { code: string } };

describe("showdowns with the players' own horses", () => {
  let t: TestApp;
  let svc: ShowdownsService;
  let host: { token: string; userId: string };
  let rider: { token: string; userId: string };
  let hostHorse: string;
  let riderHorses: string[];
  let code: string;
  const call = defaultConfig.showdown.callSeconds * 1000;
  const view = async (token = host.token) => (await t.get<ShowdownDto>(`/showdowns/${code}`, token)).body;
  const real = (id: string) =>
    t.db.one<{ fatigue: number; starts: number; race_rating: number; earnings: number }>(
      "SELECT fatigue, starts, race_rating, earnings FROM horses WHERE id = $1",
      [id],
    );

  beforeAll(async () => {
    t = await createTestApp();
    svc = t.service(ShowdownsService);
    host = await t.login(9871, "Trainer");
    rider = await t.login(9872, "Rival");
    hostHorse = (await t.get<HorseSummaryDto[]>("/horses", host.token)).body[0]!.id;
    await t.giveKeeper(rider.userId);
    riderHorses = (await t.get<HorseSummaryDto[]>("/horses", rider.token)).body.map((h) => h.id);
    expect(riderHorses).toHaveLength(2);
  });
  afterAll(() => t.close());

  it("the host enters 1–3 of their own horses; nobody else's", async () => {
    const base = { name: "Stable Wars", mode: "OWN_HORSES", displayName: "trainer" };
    expect((await t.post<Err>("/showdowns", base, host.token)).body.error!.code).toBe("PICK_HORSES");
    expect(
      (await t.post<Err>("/showdowns", { ...base, horseIds: [riderHorses[0]] }, host.token)).body.error!.code,
    ).toBe("NOT_YOUR_HORSE");
    const res = await t.post<ShowdownDto>("/showdowns", { ...base, horseIds: [hostHorse] }, host.token);
    expect(res.status).toBe(201);
    code = res.body.code;
    // Own horses only: no pace horses, whatever was asked.
    expect(res.body).toMatchObject({ mode: "OWN_HORSES", fillField: false, maxHorsesPerPlayer: 3 });
    expect(res.body.players[0]!.horses.map((h) => h.id)).toEqual([hostHorse]);
  });

  it("a rival joins with two horses", async () => {
    const res = await t.post<ShowdownDto>(
      `/showdowns/${code}/join`,
      { displayName: "rival", horseIds: riderHorses },
      rider.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.players.find((p) => p.me)!.horses).toHaveLength(2);
  });

  it("tactics are per horse, and one horse can sit a race out", async () => {
    const called = await t.post<ShowdownDto>(`/showdowns/${code}/races`, { distance: 1400 }, host.token);
    const race = called.body.races[0]!;
    const tac = `/showdowns/${code}/races/${race.id}/tactics`;
    expect((await t.post<Err>(tac, { strategy: "CLOSER" }, rider.token)).body.error!.code).toBe("PICK_HORSE");
    await t.post(tac, { strategy: "FRONT_RUNNER", horseId: riderHorses[0] }, rider.token);
    const v = await t.post<ShowdownDto>(tac, { strategy: null, horseId: riderHorses[1] }, rider.token);
    expect(v.body.races[0]!.myHorses).toEqual([
      expect.objectContaining({ horseId: riderHorses[0], strategy: "FRONT_RUNNER" }),
      expect.objectContaining({ horseId: riderHorses[1], strategy: null }),
    ]);
    expect(
      (await t.post<Err>(`/showdowns/${code}/horses`, { horseIds: [riderHorses[1]] }, rider.token)).body
        .error!.code,
    ).toBe("RACE_IN_PROGRESS");
  });

  it("only the entered stable horses run, linked to their pages; the real horses are untouched", async () => {
    const before = await real(hostHorse);
    t.clock.advance(call + 1000);
    expect(await svc.runDue()).toBe(1);
    const running = await view();
    const runners = running.current!.entryList;
    expect(runners.map((e) => e.horseId).sort()).toEqual([hostHorse, riderHorses[0]].sort());
    expect(runners.every((e) => !e.isHouse && e.ownerId)).toBe(true);
    t.clock.advance(5 * 60_000);
    const done = await view(rider.token);
    expect(done.players.map((p) => p.points).sort((a, b) => b - a)).toEqual([10, 8]);
    expect(done.players.every((p) => p.races === 1)).toBe(true);
    expect(await real(hostHorse)).toEqual(before);
  });

  it("horses can be changed between races", async () => {
    const res = await t.post<ShowdownDto>(
      `/showdowns/${code}/horses`,
      { horseIds: [riderHorses[1]] },
      rider.token,
    );
    expect(res.body.players.find((p) => p.me)!.horses.map((h) => h.id)).toEqual([riderHorses[1]]);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
