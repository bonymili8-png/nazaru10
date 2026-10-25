import type {
  HomeDto,
  HorseSummaryDto,
  LiveRaceDto,
  PublicHorseDto,
  RaceDetailDto,
  RaceSummaryDto,
  UserDto,
  ViralStatsDto,
} from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string; horseId: string; code: string };

describe("public share pages and the viral loop", () => {
  let t: TestApp;
  let shy: User;
  let proud: User;
  let friend: { token: string; userId: string };
  let race: RaceSummaryDto;
  const runner = () => t.service(RaceRunnerService);
  const login = async (id: number, name: string, start?: string): Promise<User> => {
    const u = await t.login(id, name, start);
    const horseId = (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id;
    const code = (await t.get<UserDto>("/me", u.token)).body.referralCode;
    return { ...u, horseId, code };
  };
  const raw = (url: string) => t.app.inject({ method: "GET", url });

  beforeAll(async () => {
    t = await createTestApp();
    shy = await login(9601, "Shy");
    proud = await login(9602, "Proud");
    // Proud shows the stable on public pages; Shy keeps the default (no owner shown).
    const s = await t.put<UserDto>("/me/settings", { publicStable: true }, proud.token);
    expect(s.body.settings).toMatchObject({ publicStable: true, sharePrompts: true });
    expect((await t.get<UserDto>("/me", shy.token)).body.settings.publicStable).toBe(false);
    await runner().scheduleAhead();
    race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=50", shy.token))
      .body[0]!;
    for (const u of [shy, proud])
      expect(
        (await t.post(`/races/${race.id}/entries`, { horseId: u.horseId, strategy: "MID_PACK" }, u.token))
          .status,
      ).toBe(201);
  });
  afterAll(() => t.close());

  it("shows nothing of a race until it is finished", async () => {
    expect((await t.get(`/public/races/${race.id}`)).status).toBe(404);
    expect((await t.get(`/public/races/${race.id}/live`)).status).toBe(404);
    expect((await raw(`/public/og/race/${race.id}`)).statusCode).toBe(404);
  });

  it("a finished race is public, with owners only by stable name and only with consent", async () => {
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner().lockDue();
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner().runDue();
    t.clock.advance(5 * 60_000);
    await runner().settleDue();

    const d = (await t.get<RaceDetailDto>(`/public/races/${race.id}`)).body;
    expect(d.status).toBe("COMPLETED");
    expect(d.entryList).toHaveLength(8);
    expect(d.entryList.every((e) => e.ownerId === null && !e.mine && e.position !== null)).toBe(true);
    const stable = (await t.get<{ name: string }>("/stable", proud.token)).body.name;
    expect(d.entryList.find((e) => e.horseId === proud.horseId)!.ownerName).toBe(stable);
    expect(d.entryList.find((e) => e.horseId === shy.horseId)!.ownerName).toBeNull();
    // No player's Telegram name anywhere.
    expect(JSON.stringify(d)).not.toMatch(/"Shy"|"Proud"|u9601|u9602/);

    const live = (await t.get<LiveRaceDto>(`/public/races/${race.id}/live`)).body;
    expect(live.frames!.data.length).toBeGreaterThan(10);
    expect(live.results!.every((e) => e.ownerId === null)).toBe(true);
  });

  it("a horse card has its record but no attributes, and the owner only with consent", async () => {
    const shyHorse = (await t.get<PublicHorseDto & Record<string, unknown>>(`/public/horses/${shy.horseId}`))
      .body;
    expect(shyHorse).toMatchObject({ id: shy.horseId, starts: 1, stable: null });
    expect(shyHorse.recent[0]).toMatchObject({ raceId: race.id, field: 8 });
    expect(shyHorse.attributes).toBeUndefined();
    expect(shyHorse.genome).toBeUndefined();
    const proudHorse = (await t.get<PublicHorseDto>(`/public/horses/${proud.horseId}`)).body;
    expect(proudHorse.stable).toBeTruthy();
    expect((await t.get("/public/horses/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("draws 1200×630 PNG preview cards for races and horses", async () => {
    for (const url of [`/public/og/race/${race.id}`, `/public/og/horse/${shy.horseId}`]) {
      const res = await raw(url);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(String(res.headers["cache-control"])).toContain("public");
      const png = res.rawPayload;
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      // IHDR: width and height, big-endian.
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
      expect(png.length).toBeGreaterThan(10_000);
    }
  });

  it("counts share-page visits and shows the viral loop to the team", async () => {
    for (let i = 0; i < 3; i++)
      expect(
        (await t.post("/public/share-visits", { kind: "race", id: race.id, ref: proud.code })).status,
      ).toBe(204);
    await t.post("/public/share-visits", { kind: "horse", id: shy.horseId });
    expect((await t.post("/public/share-visits", { kind: "race", id: "nope" })).status).toBe(400);

    // A friend joins through Proud's link: the home screen carries the invite until the first race.
    friend = await t.login(9603, "Friend", `race_${race.id}_r${proud.code}`);
    const home = (await t.get<HomeDto>("/home", friend.token)).body;
    expect(home.invite).toEqual({
      stable: (await t.get<{ name: string }>("/stable", proud.token)).body.name,
    });
    expect((await t.get<HomeDto>("/home", proud.token)).body.invite).toBeNull();

    expect((await t.get("/admin/viral", proud.token)).status).toBe(403);
    await t.db.query("UPDATE users SET role = 'GAME_ADMIN' WHERE id = $1", [shy.userId]);
    const v = (await t.get<ViralStatsDto>("/admin/viral?days=7", shy.token)).body;
    expect(v).toMatchObject({
      days: 7,
      shareVisits: 4,
      sharedByPlayers: 3,
      sharers: 1,
      referredSignups: 1,
      referredFirstRace: 0,
    });
    expect(v.activePlayers).toBeGreaterThanOrEqual(3);
  });
});
