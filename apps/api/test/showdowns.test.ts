import type { LiveRaceDto, ShowdownDto, ShowdownSummaryDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShowdownsService } from "../src/modules/showdowns/showdowns.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type Err = { error?: { code: string } };

describe("showdowns", () => {
  let t: TestApp;
  let svc: ShowdownsService;
  let host: { token: string; userId: string };
  let rider: { token: string; userId: string };
  let code: string;
  const call = defaultConfig.showdown.callSeconds * 1000;
  const view = async (token = host.token) => (await t.get<ShowdownDto>(`/showdowns/${code}`, token)).body;
  const credits = async (token: string) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", token)).body.balances.CREDITS;

  beforeAll(async () => {
    t = await createTestApp();
    svc = t.service(ShowdownsService);
    host = await t.login(9851, "Streamer");
    rider = await t.login(9852, "Guest");
  });
  afterAll(() => t.close());

  it("a host creates a showdown and gets a tournament horse", async () => {
    const res = await t.post<ShowdownDto>(
      "/showdowns",
      { name: "Friday Night Derby", mode: "NO_FATIGUE", displayName: "@streamer_one" },
      host.token,
    );
    expect(res.status).toBe(201);
    code = res.body.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(res.body).toMatchObject({ isHost: true, joined: true, mode: "NO_FATIGUE", status: "OPEN" });
    expect(res.body.players).toHaveLength(1);
    expect(res.body.players[0]).toMatchObject({ displayName: "@streamer_one", points: 0, me: true });
    expect(res.body.players[0]!.horseName.length).toBeGreaterThan(3);
  });

  it("players join by code with their own name", async () => {
    expect(
      (await t.post<Err>(`/showdowns/${code}/join`, { displayName: "@STREAMER_ONE" }, rider.token)).body
        .error!.code,
    ).toBe("NAME_TAKEN");
    expect((await t.post(`/showdowns/${code}/join`, { displayName: "Кирилиця" }, rider.token)).status).toBe(
      400,
    );
    const res = await t.post<ShowdownDto>(
      `/showdowns/${code}/join`,
      { displayName: "guest.rider" },
      rider.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.players).toHaveLength(2);
    expect((await t.get<ShowdownSummaryDto[]>("/showdowns", rider.token)).body[0]).toMatchObject({
      code,
      isHost: false,
    });
    expect((await t.get(`/showdowns/ZZZZZZ`, rider.token)).status).toBe(404);
  });

  it("only the host calls races; players choose tactics or rest", async () => {
    expect((await t.post(`/showdowns/${code}/races`, {}, rider.token)).status).toBe(403);
    expect((await t.post(`/showdowns/${code}/races`, { distance: 1111 }, host.token)).status).toBe(400);
    const called = await t.post<ShowdownDto>(
      `/showdowns/${code}/races`,
      { distance: 1200, surface: "TURF" },
      host.token,
    );
    expect(called.status).toBe(201);
    const race = called.body.races[0]!;
    expect(race).toMatchObject({ no: 1, distance: 1200, surface: "TURF", status: "CALLED" });
    expect((await t.post<Err>(`/showdowns/${code}/races`, {}, host.token)).body.error!.code).toBe(
      "RACE_IN_PROGRESS",
    );
    const set = await t.post<ShowdownDto>(
      `/showdowns/${code}/races/${race.id}/tactics`,
      { strategy: "FRONT_RUNNER" },
      rider.token,
    );
    expect(set.body.races[0]).toMatchObject({ myStrategy: "FRONT_RUNNER", myResting: false });
    const stranger = await t.login(9853, "Troll");
    expect(
      (await t.post(`/showdowns/${code}/races/${race.id}/tactics`, { strategy: "CLOSER" }, stranger.token))
        .status,
    ).toBe(403);
  });

  it("runs at the off with a full field, streams live, and scores only when the result is public", async () => {
    t.clock.advance(call + 1000);
    expect(await svc.runDue()).toBe(1);
    const running = await view();
    const race = running.races[0]!;
    expect(race.status).toBe("RUNNING");
    expect(running.current!.entryList).toHaveLength(defaultConfig.showdown.fieldSize);
    expect(running.current!.entryList.filter((e) => !e.isHouse)).toHaveLength(2);
    // No spoilers: points wait for the finish.
    expect(running.players.every((p) => p.points === 0)).toBe(true);
    t.clock.advance(10_000);
    // The public broadcast needs no sign-in.
    const pub = await t.get<LiveRaceDto>(`/public/showdowns/${code}/races/${race.id}/live`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ status: "RUNNING", results: null });
    expect(pub.body.frames!.data.length).toBeLessThanOrEqual(12);

    t.clock.advance(5 * 60_000);
    const done = await view(rider.token);
    expect(done.races[0]!.status).toBe("COMPLETED");
    expect(done.races[0]!.results!.map((r) => r.points).sort((a, b) => b - a)).toEqual([10, 8]);
    expect(done.players.map((p) => p.points).sort((a, b) => b - a)).toEqual([10, 8]);
    expect(done.players.every((p) => p.races === 1 && p.fatigue === 0)).toBe(true);
    expect(done.players[0]!.rank).toBe(1);
    const pubView = await t.get<ShowdownDto>(`/public/showdowns/${code}`);
    expect(pubView.status).toBe(200);
    expect(pubView.body).toMatchObject({ isHost: false, joined: false });
  });

  it("a player can sit a race out; nobody's wallet or stable is touched", async () => {
    const called = await t.post<ShowdownDto>(`/showdowns/${code}/races`, {}, host.token);
    const id = called.body.races[0]!.id;
    await t.post(`/showdowns/${code}/races/${id}/tactics`, { strategy: null }, rider.token);
    expect((await view(rider.token)).races[0]).toMatchObject({ myResting: true, myStrategy: null });
    t.clock.advance(call + 5 * 60_000);
    await svc.runDue();
    await svc.runDue();
    const v = await view(rider.token);
    expect(v.races[0]!.results!.map((r) => r.displayName)).toEqual(["@streamer_one"]);
    expect(v.players.find((p) => p.me)!.races).toBe(1);
    expect(await credits(rider.token)).toBe(5000);
    expect(await credits(host.token)).toBe(5000);
  });

  it("in NORMAL mode the horses tire from race to race", async () => {
    const s = (
      await t.post<ShowdownDto>(
        "/showdowns",
        { name: "Stamina Cup", mode: "NORMAL", displayName: "host" },
        host.token,
      )
    ).body;
    await t.post(`/showdowns/${s.code}/races`, { distance: 2400 }, host.token);
    t.clock.advance(call + 5 * 60_000);
    await svc.runDue();
    await svc.runDue();
    const v = (await t.get<ShowdownDto>(`/showdowns/${s.code}`, host.token)).body;
    expect(v.players[0]!.fatigue).toBeGreaterThan(20);
  });

  it("the host finishes it; then nothing more can be called", async () => {
    expect((await t.post(`/showdowns/${code}/finish`, {}, rider.token)).status).toBe(403);
    expect((await t.post<ShowdownDto>(`/showdowns/${code}/finish`, {}, host.token)).body.status).toBe(
      "FINISHED",
    );
    expect((await t.post<Err>(`/showdowns/${code}/races`, {}, host.token)).body.error!.code).toBe(
      "SHOWDOWN_FINISHED",
    );
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
