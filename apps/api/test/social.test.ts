import type { HorseSummaryDto, RaceSummaryDto, SocialAdminDto } from "@thoroughline/contracts";
import { defaultConfig as cfg, randomEntrant, Rng, simulateRace, trackByCode } from "@thoroughline/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MarketingService } from "../src/modules/marketing/marketing.service.js";
import { socialCaption, socialTitle } from "../src/modules/marketing/posts.js";
import { blueskyText, type SocialPost } from "../src/modules/marketing/social-api.js";
import { SocialService } from "../src/modules/marketing/social.service.js";
import { ffmpegAvailable, renderRaceVideo, timeline, winnerTime } from "../src/modules/marketing/video.js";
import { RaceRunnerService } from "../src/modules/races/race-runner.service.js";
import { createTestApp, type TestApp } from "./helpers.js";

const HOUR = 3_600_000;
/** Without ffmpeg (a bare dev machine) the video parts are skipped. */
const hasFfmpeg = ffmpegAvailable();

const simulated = () => {
  const rng = new Rng("video");
  const field = Array.from({ length: 7 }, (_, i) => randomEntrant(rng, `h${i}`, 0.5, cfg));
  const res = simulateRace(
    field,
    { distance: 1600, track: trackByCode("EUROTURF"), weather: "SUNNY", wetness: 1 },
    "s",
    cfg,
  );
  const pos = new Map(res.results.map((r) => [r.entrantId, r.position]));
  return {
    headline: "RACE OF THE DAY",
    raceName: "Test Stakes",
    meta: "Euroturf · 1600m turf · good",
    distance: 1600,
    frames: res.frames,
    runners: res.frames.ids.map((id, i) => ({
      id,
      name: `Horse ${i}`,
      gate: i + 1,
      silks: null,
      position: pos.get(id) ?? null,
    })),
    winnerLine: "WINS BY A NECK",
    handle: "@thoroughline_racing_bot",
  };
};

describe("race videos", () => {
  it("fast-forwards the run-up, plays the finish in real time and ends on the result", () => {
    const input = simulated();
    const shots = timeline(input, 25);
    const seconds = shots.length / 25;
    expect(seconds).toBeGreaterThan(20);
    expect(seconds).toBeLessThan(40);
    const race = shots.filter((s) => s.scene === "race") as { t: number; speed: number }[];
    expect(race[0]).toEqual({ scene: "race", t: 0, speed: 1 });
    // Time only moves forward, faster early on, at real speed over the line.
    for (let i = 1; i < race.length; i++) expect(race[i]!.t).toBeGreaterThanOrEqual(race[i - 1]!.t - 1e-9);
    expect(Math.max(...race.map((s) => s.speed))).toBeGreaterThan(3);
    const tw = winnerTime(input.frames, input.distance);
    const atLine = race.find((s) => s.t >= tw)!;
    expect(atLine.speed).toBe(1);
    expect(shots.at(-1)!.scene).toBe("result");
  });

  it("renders an MP4 with H.264 video", async () => {
    if (!(await hasFfmpeg)) return;
    const mp4 = await renderRaceVideo(simulated(), 3);
    expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
    expect(mp4.length).toBeGreaterThan(10_000);
  }, 60_000);
});

describe("captions for other networks", () => {
  const payload = {
    raceId: "r1",
    raceName: "Royal Meadow Downs Class 5 Handicap Over Seven Furlongs",
    winner: "Bold Ruler",
    winnerHouse: false,
    margin: 0.1,
    expectedRank: 5,
    field: 8,
    distance: 1400,
    going: "GOOD",
    trackName: "Royal Meadow Downs",
  };
  const play = { link: "https://t.me/bot/play?startapp=race_r1_cYTSHORTS", bot: "thoroughline_racing_bot" };

  it("fit each network's rules and always say there is no betting", () => {
    const yt = socialCaption("RACE_OF_THE_DAY", payload, 0, "YOUTUBE", play);
    expect(yt).toContain(play.link);
    expect(yt).not.toContain("<b>");
    const ig = socialCaption("RACE_OF_THE_DAY", payload, 0, "INSTAGRAM", play);
    expect(ig).not.toContain("https://");
    expect(ig).toContain("link in bio");
    const th = socialCaption("RACE_OF_THE_DAY", payload, 0, "THREADS", play);
    expect(th.length).toBeLessThanOrEqual(500);
    const bs = blueskyText(socialCaption("RACE_OF_THE_DAY", payload, 0, "BLUESKY", play), {
      text: "▶ Play free in Telegram",
      url: play.link,
    });
    expect([...bs.text].length).toBeLessThanOrEqual(300);
    for (const c of [yt, ig, th, bs.text]) expect(c).toContain("no betting");
    const title = socialTitle("RACE_OF_THE_DAY", payload);
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title).toMatch(/^Bold Ruler wins by a short head .*#Shorts$/);
  });

  it("makes Bluesky's link and hashtags clickable at the right bytes", () => {
    const { text, facets } = blueskyText("😮 Upset\n#horseracing", { text: "▶ Play", url: "https://x.y" });
    const bytes = new TextEncoder().encode(text);
    const slice = (f: unknown) => {
      const i = (f as { index: { byteStart: number; byteEnd: number } }).index;
      return new TextDecoder().decode(bytes.subarray(i.byteStart, i.byteEnd));
    };
    expect(facets.map(slice)).toEqual(["▶ Play", "#horseracing"]);
  });
});

describe("the game's own accounts on other networks", () => {
  let t: TestApp;
  let admin: { token: string; userId: string };
  let race: RaceSummaryDto;
  const svc = () => t.service(SocialService);
  const view = async () => (await t.get<SocialAdminDto>("/admin/marketing/social", admin.token)).body;
  const posts = () =>
    t.social.calls
      .filter((c) => c.method === "publish")
      .map((c) => ({
        platform: c.args[0] as string,
        post: c.args[1] as SocialPost,
        token: c.args[2] as string,
      }));
  const at = (hourUtc: number) => {
    const now = t.clock.now();
    const d = new Date(now);
    d.setUTCHours(hourUtc, 0, 0, 0);
    if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
    t.clock.advance(d.getTime() - now.getTime());
  };
  const env = {
    WEBAPP_URL: "https://game.example.com",
    API_PUBLIC_URL: "https://api.example.com",
    GOOGLE_CLIENT_ID: "g-id",
    GOOGLE_CLIENT_SECRET: "g-secret",
    META_APP_ID: "m-id",
    META_APP_SECRET: "m-secret",
    THREADS_APP_ID: "t-id",
    THREADS_APP_SECRET: "t-secret",
    BLUESKY_HANDLE: "thoroughline.bsky.social",
    BLUESKY_APP_PASSWORD: "app-pass",
  };
  /** Sign in to a network the way the console does: the sign-in address, then its return. */
  const connect = async (platform: string, code: string) => {
    const r = await t.post<{ url: string }>(`/admin/marketing/social/${platform}/connect`, {}, admin.token);
    expect(r.status).toBe(200);
    const url = new URL(r.body.url);
    const provider = { YOUTUBE: "google", FACEBOOK: "meta", THREADS: "threads" }[platform]!;
    expect(url.searchParams.get("redirect_uri")).toBe(
      `https://api.example.com/marketing/oauth/${provider}/callback`,
    );
    return t.app.inject({
      method: "GET",
      url: `/marketing/oauth/${provider}/callback?code=${code}&state=${encodeURIComponent(url.searchParams.get("state")!)}`,
    });
  };

  beforeAll(async () => {
    Object.assign(process.env, env);
    t = await createTestApp();
    t.service(SocialService).videoFps = 3;
    admin = await t.login(9801, "Editor");
    await t.db.query("UPDATE users SET role = 'CONTENT_ADMIN' WHERE id = $1", [admin.userId]);
    const players: { token: string; horseId: string }[] = [];
    for (const id of [9802, 9803]) {
      const u = await t.login(id, `Owner${id}`);
      players.push({ ...u, horseId: (await t.get<HorseSummaryDto[]>("/horses", u.token)).body[0]!.id });
    }
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
    // The Telegram channel is not under test here.
    await t.post("/admin/marketing/switch", { key: "TELEGRAM", enabled: false }, admin.token);
  });
  afterAll(async () => {
    for (const k of Object.keys(env)) delete process.env[k];
    await t.close();
  });

  it("shows each network's setup to the content team only", async () => {
    expect((await t.get("/admin/marketing/social", (await t.login(9804)).token)).status).toBe(403);
    const v = await view();
    expect(v).toMatchObject({ enabled: true, apiUrl: "https://api.example.com", ffmpeg: await hasFfmpeg });
    expect(v.redirectUris.META).toBe("https://api.example.com/marketing/oauth/meta/callback");
    const by = Object.fromEntries(v.platforms.map((p) => [p.platform, p]));
    expect(by.YOUTUBE).toMatchObject({ connect: "OAUTH", missing: [], account: null, campaign: "YTSHORTS" });
    expect(by.YOUTUBE!.kinds).not.toContain("WEEKLY_TOP");
    expect(by.BLUESKY).toMatchObject({ connect: "SERVER", account: { name: "@thoroughline.bsky.social" } });
    expect(by.INSTAGRAM!.bioLink).toBe("https://t.me/thoroughline_racing_bot/play?startapp=c_IGREELS");
    // Bluesky is set on the server, not connected from the console.
    expect((await t.post("/admin/marketing/social/BLUESKY/connect", {}, admin.token)).status).toBe(400);
  });

  it("connects accounts through the networks' own sign-in, keeping tokens encrypted", async () => {
    const yt = await connect("YOUTUBE", "abc");
    expect(yt.statusCode).toBe(200);
    expect(yt.headers["content-type"]).toContain("text/html");
    expect(yt.body).toContain("YouTube (Thoroughline) connected");
    const meta = await connect("FACEBOOK", "m1");
    expect(meta.body).toContain("Facebook (Thoroughline Racing), Instagram (@thoroughline) connected");
    expect((await connect("THREADS", "t1")).statusCode).toBe(200);
    const stored = await t.db.query<{ platform: string; secret: Buffer }>(
      "SELECT platform, secret FROM social_accounts",
    );
    expect(stored.map((r) => r.platform).sort()).toEqual(["FACEBOOK", "INSTAGRAM", "THREADS", "YOUTUBE"]);
    for (const r of stored) expect(r.secret.toString("latin1")).not.toMatch(/rt-abc|pt-m1|th-t1/);
    const audit = await t.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'MARKETING_SOCIAL_CONNECTED' AND actor_id = $1",
      [admin.userId],
    );
    expect(audit!.n).toBe(4);
    // A forged or refused sign-in connects nothing.
    const forged = await t.app.inject({
      method: "GET",
      url: "/marketing/oauth/google/callback?code=x&state=abc.def",
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.body).toContain("not valid");
    const r = await t.post<{ url: string }>("/admin/marketing/social/YOUTUBE/connect", {}, admin.token);
    const state = new URL(r.body.url).searchParams.get("state")!;
    const bad = await t.app.inject({
      method: "GET",
      url: `/marketing/oauth/google/callback?code=bad&state=${encodeURIComponent(state)}`,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("invalid code");
    // Google's state does not open Meta's door.
    const cross = await t.app.inject({
      method: "GET",
      url: `/marketing/oauth/meta/callback?code=x&state=${encodeURIComponent(state)}`,
    });
    expect(cross.statusCode).toBe(400);
    const v = await view();
    expect(v.platforms.find((p) => p.platform === "YOUTUBE")!.account).toMatchObject({
      id: "UC123",
      name: "Thoroughline",
    });
  });

  it("posts the race as a video, one network at a time, each with its own campaign link", async () => {
    expect(await t.service(MarketingService).detect()).toBeGreaterThanOrEqual(1);
    // Only the race of the day (a player's first win is queued too when one of them won).
    await t.db.query("UPDATE content_items SET skipped_by = $1 WHERE kind <> 'RACE_OF_THE_DAY'", [
      admin.userId,
    ]);
    const order: string[] = [];
    for (let i = 0; i < 6; i++) if (await svc().tick()) order.push(posts().at(-1)!.platform);
    expect(order).toEqual(["YOUTUBE", "INSTAGRAM", "FACEBOOK", "THREADS", "BLUESKY"]);
    const all = posts();
    const yt = all.find((p) => p.platform === "YOUTUBE")!;
    expect(yt.token).toBe("rt-abc");
    expect(yt.post.title).toContain("#Shorts");
    expect(yt.post.text).toContain(`startapp=race_${race.id}_cYTSHORTS`);
    const ig = all.find((p) => p.platform === "INSTAGRAM")!;
    expect(ig.post.text).not.toContain("https://");
    const bs = all.find((p) => p.platform === "BLUESKY")!;
    expect(bs.post.video).toBeNull();
    expect(bs.post.link.url).toContain("cBSKYPOST");
    // Never a player's Telegram name.
    expect(JSON.stringify(all.map((p) => p.post.text))).not.toMatch(/Owner98|Editor/);
    if (await hasFfmpeg) {
      expect(yt.post.video!.url).toMatch(/^https:\/\/api\.example\.com\/public\/media\/[0-9a-f-]{36}\.mp4$/);
      expect(yt.post.video!.bytes.subarray(4, 8).toString()).toBe("ftyp");
      expect(ig.post.image.url).toMatch(/\.jpg$/);
      // The networks fetch the media from the public address, ranges included.
      const path = new URL(yt.post.video!.url).pathname;
      const full = await t.app.inject({ method: "GET", url: path });
      expect(full.statusCode).toBe(200);
      expect(full.headers["content-type"]).toBe("video/mp4");
      const part = await t.app.inject({ method: "GET", url: path, headers: { range: "bytes=0-99" } });
      expect(part.statusCode).toBe(206);
      expect(part.rawPayload.length).toBe(100);
      expect(part.headers["content-range"]).toBe(`bytes 0-99/${full.rawPayload.length}`);
      // The team can watch the video from the console.
      const item = await t.db.one<{ id: string }>(
        "SELECT id FROM content_items WHERE kind = 'RACE_OF_THE_DAY'",
      );
      const pv = await t.post<{ url: string }>(`/admin/marketing/items/${item!.id}/video`, {}, admin.token);
      expect(pv.body.url).toBe(yt.post.video!.url);
    }
    expect((await t.app.inject({ method: "GET", url: "/public/media/nope.mp4" })).statusCode).toBe(404);
    const camp = await t.db.one<{ created_by: string | null; platform: string }>(
      "SELECT created_by, platform FROM campaigns WHERE code = 'YTSHORTS'",
    );
    expect(camp).toEqual({ created_by: null, platform: "YOUTUBE" });
    const v = await view();
    const ytView = v.platforms.find((p) => p.platform === "YOUTUBE")!;
    expect(ytView).toMatchObject({ publishedToday: 1 });
    expect(ytView.recent[0]).toMatchObject({ status: "PUBLISHED", url: "https://social.example/youtube-1" });
    // Nothing left that is new to anyone: no second post anywhere.
    expect(await svc().tick()).toBe(0);
  });

  it("pauses a network after repeated failures, tells the team, and resumes on request", async () => {
    await t.db.query(
      `INSERT INTO content_items (kind, dedupe_key, payload, priority, created_at, expires_at)
       VALUES ('WEEKLY_TOP', 'week:social', $1, 25, $2, $3)`,
      [
        JSON.stringify({
          week: "social",
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
    t.social.publishError = "Facebook photo: (#200) Permissions error";
    for (let i = 0; i < 3; i++) {
      const r = await t.post<{ published: number }>(
        "/admin/marketing/social/FACEBOOK/publish-next",
        {},
        admin.token,
      );
      expect(r.body.published).toBe(0);
    }
    let fb = (await view()).platforms.find((p) => p.platform === "FACEBOOK")!;
    expect(fb.paused?.reason).toContain("Permissions error");
    expect(fb.recent[0]).toMatchObject({ status: "FAILED", attempts: 3, kind: "WEEKLY_TOP" });
    const alert = await t.db.one<{ payload: { channel: string } }>(
      "SELECT payload FROM domain_events WHERE type = 'marketing_alert' AND payload->>'userId' = $1",
      [admin.userId],
    );
    expect(alert!.payload.channel).toBe("Facebook");
    t.social.publishError = null;
    expect(
      (await t.post<{ published: number }>("/admin/marketing/social/FACEBOOK/publish-next", {}, admin.token))
        .body.published,
    ).toBe(0);
    fb = (
      await t.post<SocialAdminDto>("/admin/marketing/social/FACEBOOK/resume", {}, admin.token)
    ).body.platforms.find((p) => p.platform === "FACEBOOK")!;
    expect(fb.paused).toBeNull();
    expect((await t.post("/admin/marketing/social/FACEBOOK/resume", {}, admin.token)).status).toBe(409);
  });

  it("has kill switches per network and for all of them, and keeps to the daily limit", async () => {
    const off = await t.post<SocialAdminDto>(
      "/admin/marketing/social/switch",
      { key: "THREADS", enabled: false, note: "pause threads" },
      admin.token,
    );
    expect(off.body.platforms.find((p) => p.platform === "THREADS")!.enabled).toBe(false);
    expect(
      (await t.post<{ published: number }>("/admin/marketing/social/THREADS/publish-next", {}, admin.token))
        .body.published,
    ).toBe(0);
    // Instagram takes the weekly top (an image) now, ignoring the gap…
    expect(
      (await t.post<{ published: number }>("/admin/marketing/social/INSTAGRAM/publish-next", {}, admin.token))
        .body.published,
    ).toBe(1);
    expect(posts().at(-1)!.post.video).toBeNull();
    // …but YouTube never gets it (no race video).
    expect(
      (await t.post<{ published: number }>("/admin/marketing/social/YOUTUBE/publish-next", {}, admin.token))
        .body.published,
    ).toBe(0);
    await t.post("/admin/marketing/social/switch", { key: "ALL", enabled: false }, admin.token);
    expect((await view()).enabled).toBe(false);
    expect(
      (await t.post<{ published: number }>("/admin/marketing/social/BLUESKY/publish-next", {}, admin.token))
        .body.published,
    ).toBe(0);
    await t.post("/admin/marketing/social/switch", { key: "ALL", enabled: true }, admin.token);
    // Bluesky posted once today; with a limit of one it may not post again.
    await t.db.query("INSERT INTO game_config (config, note) VALUES ($1, 'test')", [
      JSON.stringify({ marketing: { social: { maxPerDay: 1 } } }),
    ]);
    await t.service((await import("../src/common/game-config.js")).GameConfigService).refresh();
    expect(
      (await t.post<{ published: number }>("/admin/marketing/social/BLUESKY/publish-next", {}, admin.token))
        .body.published,
    ).toBe(0);
    expect(
      (await t.post("/admin/marketing/social/switch", { key: "TIKTOK", enabled: true }, admin.token)).status,
    ).toBe(400);
  });

  it("keeps Threads' token alive and lets the team disconnect an account", async () => {
    t.clock.advance(31 * 24 * HOUR);
    expect(await svc().refreshDue()).toBe(1);
    expect(await svc().refreshDue()).toBe(0);
    const r = await t.post<SocialAdminDto>("/admin/marketing/social/YOUTUBE/disconnect", {}, admin.token);
    expect(r.body.platforms.find((p) => p.platform === "YOUTUBE")!.account).toBeNull();
    expect((await t.post("/admin/marketing/social/YOUTUBE/disconnect", {}, admin.token)).status).toBe(404);
    expect((await t.post("/admin/marketing/social/NOPE/disconnect", {}, admin.token)).status).toBe(400);
  });
});
