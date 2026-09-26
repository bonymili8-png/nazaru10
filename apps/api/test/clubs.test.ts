import type { ClubDetailDto, ClubSummaryDto, MyClubDto } from "@thoroughline/contracts";
import { defaultConfig, seasonAt } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type User = { token: string; userId: string };
const HOUR = 3_600_000;

describe("clubs", () => {
  let t: TestApp;
  let ann: User;
  let ben: User;
  let cat: User;
  let club: ClubDetailDto;
  const cfg = defaultConfig.clubs;

  const credits = async (u: User) =>
    (await t.get<{ balances: { CREDITS: number } }>("/wallet", u.token)).body.balances.CREDITS;

  beforeAll(async () => {
    t = await createTestApp();
    ann = await t.login(8101, "Ann");
    ben = await t.login(8102, "Ben");
    cat = await t.login(8103, "Cat");
  });
  afterAll(() => t.close());

  it("founds a club for credits and makes the founder its owner", async () => {
    const before = await credits(ann);
    const r = await t.post<ClubDetailDto>(
      "/clubs",
      { name: "Night Riders", tag: "nr", description: "Evening racers" },
      ann.token,
    );
    expect(r.status).toBe(201);
    club = r.body;
    expect(club).toMatchObject({ name: "Night Riders", tag: "NR", members: 1, myRole: "OWNER" });
    expect(await credits(ann)).toBe(before - cfg.createCost);
    expect((await t.get<MyClubDto>("/clubs/mine", ann.token)).body.clubId).toBe(club.id);
  });

  it("validates names and keeps names and tags unique", async () => {
    const make = (body: unknown, u = ben) => t.post<{ error: { code: string } }>("/clubs", body, u.token);
    expect((await make({ name: "x", tag: "AB" })).status).toBe(400);
    expect((await make({ name: "Valid name", tag: "A" })).status).toBe(400);
    expect((await make({ name: "<script>", tag: "XSS" })).status).toBe(400);
    const dupName = await make({ name: "night riders", tag: "ZZ" });
    expect([dupName.status, dupName.body.error.code]).toEqual([409, "CLUB_NAME_TAKEN"]);
    const dupTag = await make({ name: "Other Club", tag: "Nr" });
    expect([dupTag.status, dupTag.body.error.code]).toEqual([409, "CLUB_TAG_TAKEN"]);
    // One club at a time.
    const again = await make({ name: "Second Club", tag: "SC" }, ann);
    expect(again.body.error.code).toBe("ALREADY_IN_CLUB");
  });

  it("lets players join until the club is full", async () => {
    const r = await t.post<ClubDetailDto>(`/clubs/${club.id}/join`, {}, ben.token);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ members: 2, myRole: "MEMBER" });
    // Fill it up with extra players.
    for (let i = 0; i < cfg.maxMembers - 2; i++) {
      const u = await t.login(8200 + i, `Filler${i}`);
      expect((await t.post(`/clubs/${club.id}/join`, {}, u.token)).status).toBe(201);
    }
    const full = await t.post<{ error: { code: string } }>(`/clubs/${club.id}/join`, {}, cat.token);
    expect(full.body.error.code).toBe("CLUB_FULL");
    const view = (await t.get<ClubDetailDto>(`/clubs/${club.id}`, cat.token)).body;
    expect(view.joinBlocked).toBe("FULL");
  });

  it("ranks clubs by their members' season points", async () => {
    const other = (await t.post<ClubDetailDto>("/clubs", { name: "Solo Stars", tag: "SOLO" }, cat.token))
      .body;
    const season = seasonAt(t.clock.now(), defaultConfig).season;
    await t.db.query(
      "INSERT INTO season_points (season, owner_id, horse_id, points, races, wins) SELECT $1, $2, id, 40, 2, 1 FROM horses WHERE owner_id = $2 LIMIT 1",
      [season, cat.userId],
    );
    await t.db.query(
      "INSERT INTO season_points (season, owner_id, horse_id, points, races, wins) SELECT $1, $2, id, 25, 1, 0 FROM horses WHERE owner_id = $2 LIMIT 1",
      [season, ben.userId],
    );
    const list = (await t.get<ClubSummaryDto[]>("/clubs", ann.token)).body;
    expect(list.map((k) => [k.tag, k.points, k.rank])).toEqual([
      ["SOLO", 40, 1],
      ["NR", 25, 2],
    ]);
    const search = (await t.get<ClubSummaryDto[]>("/clubs?q=solo", ann.token)).body;
    expect(search.map((k) => k.id)).toEqual([other.id]);
    const detail = (await t.get<ClubDetailDto>(`/clubs/${club.id}`, ann.token)).body;
    expect(detail.memberList[0]).toMatchObject({ name: "Ben", points: 25 });
  });

  it("lets only the owner remove members", async () => {
    const kick = (by: User, target: User) => t.post(`/clubs/members/${target.userId}/kick`, {}, by.token);
    expect((await kick(ben, ann)).status).toBe(403);
    expect((await kick(ann, ann)).status).toBe(409);
    expect((await kick(ann, cat)).status).toBe(404); // not in this club
    const r = await kick(ann, ben);
    expect(r.status).toBe(201);
    // Removed players may join another club at once (no cooldown).
    expect((await t.get<MyClubDto>("/clubs/mine", ben.token)).body).toMatchObject({
      clubId: null,
      cooldownUntil: null,
    });
    const audit = await t.db.query("SELECT 1 FROM audit_logs WHERE action = 'CLUB_KICK'");
    expect(audit).toHaveLength(1);
  });

  it("hands the club to the longest-serving member when the owner leaves, with a rejoin cooldown", async () => {
    const r = await t.post<MyClubDto>("/clubs/leave", {}, ann.token);
    expect(r.status).toBe(201);
    expect(r.body.clubId).toBeNull();
    expect(r.body.cooldownUntil).not.toBeNull();
    const view = (await t.get<ClubDetailDto>(`/clubs/${club.id}`, ann.token)).body;
    expect(view.memberList.find((m) => m.role === "OWNER")?.name).toBe("Filler0");
    expect(view.joinBlocked).toBe("COOLDOWN");
    const blocked = await t.post<{ error: { code: string } }>(`/clubs/${club.id}/join`, {}, ann.token);
    expect(blocked.body.error.code).toBe("CLUB_COOLDOWN");
    t.clock.advance(cfg.rejoinCooldownHours * HOUR + 1000);
    expect((await t.post(`/clubs/${club.id}/join`, {}, ann.token)).status).toBe(201);
  });

  it("disbands a club when its last member leaves, freeing the name", async () => {
    const solo = (await t.get<MyClubDto>("/clubs/mine", cat.token)).body.clubId!;
    await t.post("/clubs/leave", {}, cat.token);
    expect((await t.get(`/clubs/${solo}`, ann.token)).status).toBe(404);
    const dave = await t.login(8104, "Dave");
    const r = await t.post<ClubDetailDto>("/clubs", { name: "Solo Stars", tag: "SOLO" }, dave.token);
    expect(r.status).toBe(201);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
