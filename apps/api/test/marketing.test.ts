import type { HorseSummaryDto, MarketingAdminDto, RaceSummaryDto } from "@thoroughline/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GameConfigService } from "../src/common/game-config.js";
import { caption, marginText } from "../src/modules/marketing/posts.js";
import { MarketingService } from "../src/modules/marketing/marketing.service.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { TournamentsService } from "../src/modules/tournaments/tournaments.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

const HOUR = 3_600_000;

describe("posts in captions", () => {
  it("speaks racing about margins", () => {
    expect(marginText(0.05)).toBe("by a nose");
    expect(marginText(0.3)).toBe("by a head");
    expect(marginText(0.5)).toBe("by a neck");
    expect(marginText(1)).toBe("by a length");
    expect(marginText(2.3)).toBe("by 2.5 lengths");
  });
  it("writes English HTML with names escaped and the no-betting line", () => {
    const text = caption(
      "RACE_OF_THE_DAY",
      {
        raceId: "x",
        raceName: "Royal Meadow Downs Class 5",
        winner: "Bold <b>Ruler",
        winnerHouse: false,
        margin: 0.1,
        expectedRank: 5,
        field: 8,
        distance: 1400,
        going: "GOOD_TO_SOFT",
        trackName: "Royal Meadow Downs",
      },
      0,
    );
    expect(text).toContain("<b>😮 Upset of the day</b>");
    expect(text).toContain("<b>Bold &lt;b&gt;Ruler</b> wins the Royal Meadow Downs Class 5 by a short head");
    expect(text).toContain("rated only 5th of 8 before the off");
    expect(text).toContain("1400m on good to soft ground");
    expect(text).toContain("no betting");
    expect(text.length).toBeLessThan(1024);
  });
});

describe("the game's own channel", () => {
  let t: TestApp;
  let admin: { token: string; userId: string };
  let players: { token: string; userId: string; horseId: string }[];
  let race: RaceSummaryDto;
  const svc = () => t.service(MarketingService);
  const photos = () => t.bot.calls.filter((c) => c.method === "sendPhoto");
  const view = async () => (await t.get<MarketingAdminDto>("/admin/marketing", admin.token)).body;
  const setOverride = async (override: unknown) => {
    await t.db.query("INSERT INTO game_config (config, note) VALUES ($1, 'test')", [
      JSON.stringify(override),
    ]);
    await t.service(GameConfigService).refresh();
  };
  const at = (hourUtc: number, plusDays = 0) => {
    const now = t.clock.now();
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + plusDays);
    d.setUTCHours(hourUtc, 0, 0, 0);
    if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
    t.clock.advance(d.getTime() - now.getTime());
  };

  beforeAll(async () => {
    process.env.WEBAPP_URL = "https://game.example.com";
    t = await createTestApp();
    admin = await t.login(9701, "Editor");
    await t.db.query("UPDATE users SET role = 'CONTENT_ADMIN' WHERE id = $1", [admin.userId]);
    players = [];
    for (const id of [9702, 9703]) {
      const u = await t.login(id, `Owner${id}`);
      players.push({ ...u, horseId: (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id });
    }
    // Race in the afternoon (UTC), when the race of the day is picked.
    at(14);
    const runner = t.service(RaceRunnerService);
    await runner.scheduleAhead();
    race = (await t.get<RaceSummaryDto[]>("/races?status=upcoming&class=MAIDEN&limit=50", admin.token))
      .body[0]!;
    for (const p of players)
      await t.post(`/races/${race.id}/entries`, { horseId: p.horseId, strategy: "MID_PACK" }, p.token);
    t.clock.advance(new Date(race.locksAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.lockDue();
    t.clock.advance(new Date(race.startsAt).getTime() - t.clock.now().getTime() + 1000);
    await runner.runDue();
    t.clock.advance(5 * 60_000);
    await runner.settleDue();
    at(16);
  });
  afterAll(async () => {
    delete process.env.WEBAPP_URL;
    await t.close();
  });

  it("only the content team sees it; the bot's access to the channel is checked", async () => {
    expect((await t.get("/admin/marketing", players[0]!.token)).status).toBe(403);
    const v = await view();
    expect(v).toMatchObject({ enabled: true, telegram: { enabled: true, channel: "@horoughline_racing" } });
    expect(v.telegram.status).toEqual({ ok: true, title: "Thoroughline Racing", error: null });
    expect(v.telegram.links.web).toBe(true);
  });

  it("queues one race of the day (idempotent), the race's best story", async () => {
    expect(await svc().detect()).toBeGreaterThanOrEqual(1);
    expect(await svc().detect()).toBe(0);
    const q = (await view()).queue;
    const day = q.find((i) => i.kind === "RACE_OF_THE_DAY")!;
    expect(day.caption).toContain(" wins the ");
    expect(day.caption).toContain("no betting");
    // Never a player's Telegram name.
    expect(JSON.stringify(q)).not.toMatch(/Owner970|Editor/);
  });

  it("posts the best item to the channel with the card, caption and tracked buttons", async () => {
    expect(await svc().publish()).toBe(1);
    const [call] = photos();
    const [chat, png, text, buttons] = call!.args as [
      string,
      Buffer,
      string,
      { text: string; url: string }[][],
    ];
    expect(chat).toBe("@horoughline_racing");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(text).toContain("<b>");
    const urls = buttons.flat().map((b) => b.url);
    const kind = (await view()).recent[0]!.kind;
    const code = { RACE_OF_THE_DAY: "TGCHDAY", FIRST_WIN: "TGCHFIRST" }[kind as "RACE_OF_THE_DAY"];
    expect(urls).toContain(`https://game.example.com/replay/?id=${race.id}&c=${code}`);
    expect(urls).toContain(`https://t.me/thoroughline_racing_bot/play?startapp=race_${race.id}_c${code}`);
    const camp = await t.db.one<{ created_by: string | null; platform: string }>(
      "SELECT created_by, platform FROM campaigns WHERE code = $1",
      [code],
    );
    expect(camp).toEqual({ created_by: null, platform: "TELEGRAM" });
    expect((await view()).recent[0]).toMatchObject({ status: "PUBLISHED", externalId: "101" });
  });

  it("keeps to the gap, the window and the daily limit; an admin can publish the next one now", async () => {
    // Something more to post: a tournament champion (the final was this race).
    await t.service(TournamentsService).scheduleAhead();
    const champ = await t.db.one<{ id: string }>("SELECT id FROM tournaments ORDER BY heats_at LIMIT 1");
    await t.db.query(
      `UPDATE tournaments SET status = 'COMPLETED', completed_at = $2, final_race_id = $3,
              winner_horse_id = $4, winner_owner_id = $5 WHERE id = $1`,
      [champ!.id, t.clock.now(), race.id, players[0]!.horseId, players[0]!.userId],
    );
    expect(await svc().detect()).toBeGreaterThanOrEqual(1);
    const champItem = (await view()).queue.find((i) => i.kind === "TOURNAMENT_CHAMPION")!;
    // The owner has not opted in: no stable name.
    expect(champItem.caption).toMatch(/<b>.+<\/b> is champion: \d+ entrants?/);
    expect(champItem.caption).not.toContain(" of ");

    // Within the gap: nothing.
    expect(await svc().publish()).toBe(0);
    // Outside the window (22:00 UTC): nothing, even after the gap.
    at(22);
    expect(await svc().publish()).toBe(0);
    // "Publish next now" ignores the window and the gap.
    const now = await t.post<MarketingAdminDto & { published: number }>(
      "/admin/marketing/publish-next",
      {},
      admin.token,
    );
    expect(now.body.published).toBe(1);
    expect(photos()).toHaveLength(2);
    // …but never the daily limit.
    await setOverride({ marketing: { telegram: { maxPerDay: 2 } } });
    await svc().detect();
    expect(
      (await t.post<{ published: number }>("/admin/marketing/publish-next", {}, admin.token)).body.published,
    ).toBe(0);
    await setOverride({});
  });

  it("has kill switches: everything, the channel and each kind, audited", async () => {
    const off = await t.post<MarketingAdminDto>(
      "/admin/marketing/switch",
      { key: "ALL", enabled: false },
      admin.token,
    );
    expect(off.body.enabled).toBe(false);
    at(12, 1);
    expect(await svc().detect()).toBe(0);
    expect(await svc().publish()).toBe(0);
    await t.post("/admin/marketing/switch", { key: "ALL", enabled: true }, admin.token);
    const kind = await t.post<MarketingAdminDto>(
      "/admin/marketing/switch",
      { key: "FIRST_WIN", enabled: false, note: "too many" },
      admin.token,
    );
    expect(kind.body.kinds.FIRST_WIN).toBe(false);
    expect(kind.body.history[0]).toMatchObject({ enabled: false, note: "too many" });
    expect(
      (await t.post("/admin/marketing/switch", { key: "NOPE", enabled: true }, admin.token)).status,
    ).toBe(400);
  });

  it("pauses itself after repeated failures, tells the team, and resumes on request", async () => {
    await t.db.query(
      `INSERT INTO content_items (kind, dedupe_key, payload, priority, created_at, expires_at)
       VALUES ('WEEKLY_TOP', 'week:test', $1, 25, $2, $3)`,
      [
        JSON.stringify({
          week: "test",
          rows: [
            { horseId: "a", name: "Alpha", rating: 1200, wins: 3, starts: 5 },
            { horseId: "b", name: "Bravo", rating: 1150, wins: 2, starts: 6 },
            { horseId: "c", name: "Charlie", rating: 1100, wins: 1, starts: 4 },
          ],
        }),
        t.clock.now(),
        new Date(t.clock.now().getTime() + 30 * HOUR),
      ],
    );
    t.bot.photoError = "Forbidden: bot is not a member of the channel chat";
    for (let i = 0; i < 3; i++) {
      at(10 + i * 4);
      expect(await svc().publish()).toBe(0);
    }
    let v = await view();
    expect(v.telegram.paused?.reason).toContain("bot is not a member");
    expect(v.recent.find((i) => i.kind === "WEEKLY_TOP")).toMatchObject({ status: "FAILED", attempts: 3 });
    const alert = await t.db.one<{ payload: { userId: string; channel: string } }>(
      "SELECT payload FROM domain_events WHERE type = 'marketing_alert'",
    );
    expect(alert!.payload).toMatchObject({ userId: admin.userId, channel: "@horoughline_racing" });
    // Paused: no posting even when everything else allows it.
    t.bot.photoError = null;
    at(12, 1);
    await svc().detect();
    expect(await svc().publish()).toBe(0);
    const r = await t.post<MarketingAdminDto>("/admin/marketing/resume", {}, admin.token);
    expect(r.body.telegram.paused).toBeNull();
    expect((await t.post("/admin/marketing/resume", {}, admin.token)).status).toBe(409);
  });

  it("checks a new channel before switching to it", async () => {
    const bad = await t.post<{ error: { code: string } }>(
      "/admin/marketing/channel",
      { channel: "@missing_channel" },
      admin.token,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("CHANNEL_NOT_READY");
    expect((await view()).telegram.channel).toBe("@horoughline_racing");
    t.bot.channelStatus = "member";
    expect(
      (await t.post("/admin/marketing/channel", { channel: "@other_channel" }, admin.token)).status,
    ).toBe(400);
    t.bot.channelStatus = "administrator";
    const ok = await t.post<MarketingAdminDto>(
      "/admin/marketing/channel",
      { channel: "@thoroughline_racing", note: "typo fixed" },
      admin.token,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.telegram.channel).toBe("@thoroughline_racing");
    expect((await t.post("/admin/marketing/channel", { channel: "not a handle" }, admin.token)).status).toBe(
      400,
    );
  });

  it("a weekly top on Mondays, and previews of any post for the team", async () => {
    await t.db.query("UPDATE horses SET starts = 3, wins = 1 WHERE owner_id IS NOT NULL");
    await t.login(9704, "Third");
    await t.db.query("UPDATE horses SET starts = 2 WHERE owner_id IS NOT NULL AND starts = 0");
    // Next Monday, 10:00 UTC.
    at(10);
    while (t.clock.now().getUTCDay() !== 1) t.clock.advance(24 * HOUR);
    await svc().detect();
    const week = (await view()).queue.find((i) => i.kind === "WEEKLY_TOP")!;
    expect(week.caption).toMatch(/Top of the week[\s\S]*1\. <b>/);
    const img = await t.app.inject({
      method: "GET",
      url: `/admin/marketing/items/${week.id}/image`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
  });
});
