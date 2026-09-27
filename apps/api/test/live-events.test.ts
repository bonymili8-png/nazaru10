import type { LiveEventDto, RaceSummaryDto, ShopHorseDto } from "@thoroughline/contracts";
import { defaultConfig } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PassService } from "../src/modules/pass/pass.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { ShopService } from "../src/modules/shop/shop.service.js";
import { assertLedgerIntegrity, createTestApp, type TestApp } from "./helpers.js";

type Err = { error: { code: string } };
const HOUR = 3_600_000;

describe("live-ops events", () => {
  let t: TestApp;
  let game: { token: string; userId: string };
  let player: { token: string; userId: string };
  const iso = (ms: number) => new Date(t.clock.now().getTime() + ms).toISOString();
  const purses = async (cls: string) =>
    Object.fromEntries(
      (await t.get<RaceSummaryDto[]>(`/races?status=upcoming&class=${cls}&limit=50`, player.token)).body.map(
        (r) => [r.id, r.purse],
      ),
    );

  beforeAll(async () => {
    t = await createTestApp();
    game = await t.login(4901, "LiveOps");
    player = await t.login(4902, "Punter");
    await t.db.query("UPDATE users SET role = 'GAME_ADMIN' WHERE id = $1", [game.userId]);
    await t.service(RaceRunnerService).scheduleAhead();
  });
  afterAll(() => t.close());

  it("is for the game team only, within limits", async () => {
    const body = {
      kind: "PURSE_BOOST",
      title: "Derby weekend",
      multiplier: 1.2,
      startsAt: iso(0),
      endsAt: iso(2 * HOUR),
    };
    expect((await t.post("/admin/events", body, player.token)).status).toBe(403);
    const tooBig = await t.post<Err>("/admin/events", { ...body, multiplier: 2 }, game.token);
    expect(tooBig.body.error.code).toBe("BAD_MULTIPLIER");
    const tooLong = await t.post<Err>("/admin/events", { ...body, endsAt: iso(8 * 24 * HOUR) }, game.token);
    expect(tooLong.body.error.code).toBe("BAD_WINDOW");
  });

  it("boosts purses of open races in the window (only the chosen classes) and restores them on cancel", async () => {
    const maiden = await purses("MAIDEN");
    const class1 = await purses("CLASS_1");
    const r = await t.post<LiveEventDto>(
      "/admin/events",
      {
        kind: "PURSE_BOOST",
        title: "Maiden festival",
        multiplier: 1.2,
        classes: ["MAIDEN"],
        startsAt: iso(0),
        endsAt: iso(3 * HOUR),
      },
      game.token,
    );
    expect(r.status).toBe(201);
    const boosted = await purses("MAIDEN");
    for (const [id, p] of Object.entries(maiden)) expect(boosted[id]).toBe(Math.round(p * 1.2));
    expect(await purses("CLASS_1")).toEqual(class1);

    // Players see it on the banner feed.
    const live = (await t.get<LiveEventDto[]>("/events", player.token)).body;
    expect(live.map((e) => e.title)).toContain("Maiden festival");

    // Races scheduled later in the window are boosted at creation.
    t.clock.advance(HOUR);
    await t.service(RaceRunnerService).scheduleAhead();
    const later = (
      await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=50", player.token)
    ).body;
    const fresh = later.filter((x) => !(x.id in maiden));
    expect(fresh.length).toBeGreaterThan(0);
    for (const x of fresh) expect(x.purse).toBe(Math.round(defaultConfig.race.classes.MAIDEN.purse * 1.2));

    const c = await t.post<LiveEventDto>(`/admin/events/${r.body.id}/cancel`, {}, game.token);
    expect(c.body.cancelled).toBe(true);
    const restored = await purses("MAIDEN");
    for (const x of later) expect(restored[x.id]).toBe(defaultConfig.race.classes.MAIDEN.purse);
    expect((await t.get<LiveEventDto[]>("/events", player.token)).body).toEqual([]);
  });

  it("multiplies Racing Pass XP while an XP boost runs", async () => {
    await t.post(
      "/admin/events",
      { kind: "PASS_XP_BOOST", title: "Double XP", multiplier: 2, startsAt: iso(0), endsAt: iso(HOUR) },
      game.token,
    );
    await t.db.tx((c) => t.service(PassService).addXp(c, player.userId, "test:xp", 20, t.clock.now()));
    const xp = (
      await t.db.query<{ xp: number }>("SELECT xp FROM pass_progress WHERE user_id = $1", [player.userId])
    )[0]!;
    expect(xp.xp).toBe(40);
  });

  it("lists a limited horse first in the shop until it expires", async () => {
    await t.service(ShopService).restock();
    const r = await t.post<ShopHorseDto>(
      "/admin/limited-horses",
      { rarity: "LEGENDARY", quality: 0.9, price: 25000, hours: 2 },
      game.token,
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ rarity: "LEGENDARY", price: 25000 });
    const shop = (await t.get<ShopHorseDto[]>("/shop/horses", player.token)).body;
    expect(shop[0]!.id).toBe(r.body.id);
    expect(shop[0]!.limitedUntil).toBeTruthy();
    // The regular catalogue keeps its size.
    expect(shop.filter((h) => !h.limitedUntil).length).toBeGreaterThan(0);

    t.clock.advance(3 * HOUR);
    const late = await t.post<Err>(`/shop/horses/${r.body.id}/buy`, {}, player.token);
    expect(late.status).toBe(404);
    await t.service(ShopService).restock();
    expect(
      (await t.get<ShopHorseDto[]>("/shop/horses", player.token)).body.some((h) => h.id === r.body.id),
    ).toBe(false);
  });

  it("keeps the ledger balanced", () => assertLedgerIntegrity(t.db));
});
