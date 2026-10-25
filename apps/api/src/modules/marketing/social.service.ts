import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  type SocialAdminDto,
  type SocialPlatform,
  type SocialPlatformDto,
  SOCIAL_PLATFORMS,
} from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { ConfigSwitchService } from "../../common/config-switch.js";
import { Db, row, rows } from "../../common/db.js";
import { badRequest, conflict, notFound } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { ENV, type Env } from "../../config/env.js";
import { renderPng, tableCardSvg, OG_HEIGHT, OG_WIDTH } from "../share/og-image.js";
import { ShareService } from "../share/share.service.js";
import { MarketingService, SWITCH_ACTION } from "./marketing.service.js";
import {
  type PostKind,
  POST_KINDS,
  RACE_KINDS,
  raceIdOf,
  SOCIAL_CAMPAIGNS,
  SOCIAL_TAGS,
  socialCaption,
  socialTitle,
  videoLines,
  type WeeklyTopPayload,
} from "./posts.js";
import {
  type AppCredentials,
  type OAuthProvider,
  SOCIAL_API,
  type SocialAccount,
  type SocialApi,
  type SocialSecret,
} from "./social-api.js";
import { ffmpegAvailable, pngToJpeg, renderRaceVideo, type RaceVideoInput } from "./video.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_ATTEMPTS = 3;
/** The background loop runs at most this often (posting itself keeps to the config's gap). */
const EVERY_MS = 60_000;
/** Media the networks have fetched long ago are dropped after a week. */
const MEDIA_TTL = 7 * DAY;
/** Threads tokens live 60 days; refreshed once less than this is left. */
const REFRESH_WHEN_LEFT = 30 * DAY;
const STATE_TTL = 30 * 60_000;

const PROVIDER: Record<SocialPlatform, OAuthProvider | null> = {
  YOUTUBE: "GOOGLE",
  FACEBOOK: "META",
  INSTAGRAM: "META",
  THREADS: "THREADS",
  BLUESKY: null,
};

const LABEL: Record<SocialPlatform, string> = {
  YOUTUBE: "YouTube",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  THREADS: "Threads",
  BLUESKY: "Bluesky",
};

const CALLBACK_PATH: Record<OAuthProvider, string> = {
  GOOGLE: "/marketing/oauth/google/callback",
  META: "/marketing/oauth/meta/callback",
  THREADS: "/marketing/oauth/threads/callback",
};

interface ItemRow {
  id: string;
  kind: PostKind;
  payload: unknown;
  priority: number;
  created_at: Date;
}

interface AccountRow {
  platform: SocialPlatform;
  account_id: string;
  name: string;
  secret: Buffer;
  expires_at: Date | null;
  connected_at: Date;
  refreshed_at: Date | null;
}

interface MediaRow {
  id: string;
  mime: string;
  bytes: Buffer;
}

/**
 * The game's own accounts on YouTube (Shorts), Instagram (Reels), Facebook (its Page), Threads
 * and Bluesky: the same real game events as the Telegram channel, as a vertical race video
 * (or the card), each network within its own daily limit, gap and window, with kill switches,
 * a pause after repeated failures and an alert to the team. Accounts are the owner's, connected
 * once from the admin console through each network's own sign-in (tokens encrypted at rest);
 * Bluesky signs in with an app password kept on the server.
 */
@Injectable()
export class SocialService {
  /** Frames per second of race videos (tests lower it). */
  videoFps = 25;
  private running = false;
  private lastRun = 0;
  private lastHousekeeping = 0;
  private readonly checks = new Map<SocialPlatform, string | null>();
  private readonly key: Buffer;

  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly switches: ConfigSwitchService,
    private readonly marketing: MarketingService,
    private readonly share: ShareService,
    private readonly clock: Clock,
    @Inject(SOCIAL_API) private readonly api: SocialApi,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.key = Buffer.from(hkdfSync("sha256", env.JWT_SECRET, "thoroughline", "social-account-tokens", 32));
  }

  private cfg() {
    return this.config.get().marketing;
  }

  /* ───────────────────────────── secrets ───────────────────────────── */

  private seal(secret: SocialSecret): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(secret), "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  }

  private open(sealed: Buffer): SocialSecret {
    const d = createDecipheriv("aes-256-gcm", this.key, sealed.subarray(0, 12));
    d.setAuthTag(sealed.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(sealed.subarray(28)), d.final()]).toString("utf8"),
    ) as SocialSecret;
  }

  /** A signed, short-lived OAuth `state` naming the admin who started the sign-in. */
  private state(provider: OAuthProvider, actorId: string): string {
    const body = Buffer.from(
      JSON.stringify({ p: provider, u: actorId, e: this.clock.now().getTime() + STATE_TTL }),
    ).toString("base64url");
    return `${body}.${createHmac("sha256", this.key).update(body).digest("base64url")}`;
  }

  private readState(provider: OAuthProvider, state: string): string {
    const [body, sig] = state.split(".");
    const want = createHmac("sha256", this.key)
      .update(body ?? "")
      .digest();
    const got = Buffer.from(sig ?? "", "base64url");
    if (!body || got.length !== want.length || !timingSafeEqual(got, want))
      throw badRequest("BAD_STATE", "This sign-in link is not valid: start again from the console");
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as { p: string; u: string; e: number };
    if (s.p !== provider || s.e < this.clock.now().getTime())
      throw badRequest("BAD_STATE", "This sign-in link has expired: start again from the console");
    return s.u;
  }

  /* ───────────────────────────── setup ───────────────────────────── */

  private apiUrl(): string | null {
    return this.env.API_PUBLIC_URL?.replace(/\/$/, "") ?? null;
  }

  private redirectUri(provider: OAuthProvider): string | null {
    const base = this.apiUrl();
    return base ? `${base}${CALLBACK_PATH[provider]}` : null;
  }

  private app(provider: OAuthProvider): AppCredentials | null {
    const [id, secret] =
      provider === "GOOGLE"
        ? [this.env.GOOGLE_CLIENT_ID, this.env.GOOGLE_CLIENT_SECRET]
        : provider === "META"
          ? [this.env.META_APP_ID, this.env.META_APP_SECRET]
          : [this.env.THREADS_APP_ID, this.env.THREADS_APP_SECRET];
    return id && secret ? { clientId: id, clientSecret: secret } : null;
  }

  /** Server settings a network still needs. */
  private missing(platform: SocialPlatform): string[] {
    const out: string[] = [];
    if (!this.apiUrl()) out.push("API_PUBLIC_URL");
    switch (PROVIDER[platform]) {
      case "GOOGLE":
        if (!this.env.GOOGLE_CLIENT_ID) out.push("GOOGLE_CLIENT_ID");
        if (!this.env.GOOGLE_CLIENT_SECRET) out.push("GOOGLE_CLIENT_SECRET");
        break;
      case "META":
        if (!this.env.META_APP_ID) out.push("META_APP_ID");
        if (!this.env.META_APP_SECRET) out.push("META_APP_SECRET");
        break;
      case "THREADS":
        if (!this.env.THREADS_APP_ID) out.push("THREADS_APP_ID");
        if (!this.env.THREADS_APP_SECRET) out.push("THREADS_APP_SECRET");
        break;
      case null:
        if (!this.env.BLUESKY_HANDLE) out.push("BLUESKY_HANDLE");
        if (!this.env.BLUESKY_APP_PASSWORD) out.push("BLUESKY_APP_PASSWORD");
        // Bluesky uploads the image itself: no public media address needed.
        return out.filter((m) => m !== "API_PUBLIC_URL");
    }
    return out;
  }

  /** The connected account (Bluesky: from the server's settings). */
  private async account(
    platform: SocialPlatform,
  ): Promise<(SocialAccount & { connectedAt: Date | null }) | null> {
    if (platform === "BLUESKY") {
      const { BLUESKY_HANDLE: handle, BLUESKY_APP_PASSWORD: password, BLUESKY_SERVICE: service } = this.env;
      if (!handle || !password) return null;
      return {
        platform,
        accountId: handle,
        name: `@${handle.replace(/^@/, "")}`,
        secret: { token: JSON.stringify({ handle: handle.replace(/^@/, ""), password, service }) },
        expiresAt: null,
        connectedAt: null,
      };
    }
    const r = await this.db.one<AccountRow>("SELECT * FROM social_accounts WHERE platform = $1", [platform]);
    if (!r) return null;
    let secret: SocialSecret;
    try {
      secret = this.open(r.secret);
    } catch {
      // Sealed under another server secret: the account has to be connected again.
      return null;
    }
    return {
      platform,
      accountId: r.account_id,
      name: r.name,
      secret,
      expiresAt: r.expires_at,
      connectedAt: r.connected_at,
    };
  }

  /** Start connecting a network: the address of its sign-in page. */
  async connectUrl(actorId: string, platform: SocialPlatform): Promise<{ url: string }> {
    const provider = PROVIDER[platform];
    if (!provider)
      throw badRequest(
        "SERVER_SETTING",
        "Bluesky is set on the server (BLUESKY_HANDLE, BLUESKY_APP_PASSWORD)",
      );
    const app = this.app(provider);
    const redirect = this.redirectUri(provider);
    if (!app || !redirect)
      throw badRequest("NOT_CONFIGURED", `Set ${this.missing(platform).join(", ")} on the server first`);
    return { url: this.api.authorizeUrl(provider, app, redirect, this.state(provider, actorId)) };
  }

  /** The network sent the admin back: keep the accounts it allowed. Returns a page to show. */
  async callback(
    provider: OAuthProvider,
    q: { code?: string; state?: string; error?: string; error_description?: string },
  ) {
    try {
      const actorId = this.readState(provider, q.state ?? "");
      if (q.error || !q.code)
        throw badRequest("DENIED", q.error_description || q.error || "Sign-in was cancelled");
      const app = this.app(provider);
      const redirect = this.redirectUri(provider);
      if (!app || !redirect) throw badRequest("NOT_CONFIGURED", "The server is not set up for this network");
      const accounts = await this.api.connect(
        provider,
        app,
        q.code,
        redirect,
        this.env.FACEBOOK_PAGE_ID || undefined,
      );
      const now = this.clock.now();
      await this.db.tx(async (c) => {
        for (const a of accounts) {
          await c.query(
            `INSERT INTO social_accounts (platform, account_id, name, secret, expires_at, connected_by, connected_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (platform) DO UPDATE SET account_id = $2, name = $3, secret = $4, expires_at = $5,
               connected_by = $6, connected_at = $7, refreshed_at = NULL`,
            [a.platform, a.accountId, a.name, this.seal(a.secret), a.expiresAt, actorId, now],
          );
          // A fresh connection clears an earlier pause.
          await c.query(
            "UPDATE marketing_channels SET paused_reason = NULL, paused_at = NULL, consecutive_failures = 0 WHERE channel = $1",
            [a.platform],
          );
          await c.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, reason)
             VALUES ($1, 'MARKETING_SOCIAL_CONNECTED', 'marketing', $2, $3)`,
            [actorId, a.platform, `${LABEL[a.platform]}: ${a.name}`],
          );
          this.checks.delete(a.platform);
        }
      });
      const names = accounts.map((a) => `${LABEL[a.platform]} (${a.name})`).join(", ");
      return {
        ok: true,
        html: page("Connected", `${names} connected. Close this tab and go back to the game in Telegram.`),
      };
    } catch (err) {
      this.logger.warn({ err, provider }, "social connect failed");
      return { ok: false, html: page("Not connected", (err as Error).message) };
    }
  }

  async disconnect(actorId: string, platform: SocialPlatform, ip: string | null): Promise<SocialAdminDto> {
    if (platform === "BLUESKY")
      throw badRequest("SERVER_SETTING", "Remove BLUESKY_APP_PASSWORD on the server to disconnect Bluesky");
    await this.db.tx(async (c) => {
      const r = await c.query("DELETE FROM social_accounts WHERE platform = $1 RETURNING platform", [
        platform,
      ]);
      if (!r.rowCount) throw notFound("Connected account");
      await c.query(
        `INSERT INTO audit_logs (actor_id, action, target_type, target_id, reason, ip)
         VALUES ($1, 'MARKETING_SOCIAL_DISCONNECTED', 'marketing', $2, 'Disconnected', $3)`,
        [actorId, platform, ip],
      );
    });
    this.checks.delete(platform);
    return this.view();
  }

  /** Ask the network whether the account still works. */
  async check(platform: SocialPlatform): Promise<SocialAdminDto> {
    const a = await this.account(platform);
    if (!a) throw notFound("Connected account");
    try {
      const provider = PROVIDER[platform];
      if (platform === "BLUESKY") {
        const s = JSON.parse(a.secret.token) as { handle: string; password: string; service: string };
        await this.api.blueskyAccount(s.handle, s.password, s.service);
      } else {
        const { name } = await this.api.check(a, this.app(provider!) ?? { clientId: "", clientSecret: "" });
        await this.db.query("UPDATE social_accounts SET name = $2 WHERE platform = $1", [platform, name]);
      }
      this.checks.set(platform, null);
    } catch (err) {
      this.checks.set(platform, (err as Error).message.slice(0, 300));
    }
    return this.view();
  }

  /** Keep long-lived tokens alive (Threads: 60 days, refreshable once a day). */
  async refreshDue(): Promise<number> {
    const now = this.clock.now();
    const due = await rows<AccountRow>(
      this.db.pool,
      `SELECT * FROM social_accounts WHERE expires_at IS NOT NULL AND expires_at < $1
          AND COALESCE(refreshed_at, connected_at) < $2`,
      [new Date(now.getTime() + REFRESH_WHEN_LEFT), new Date(now.getTime() - DAY)],
    );
    let n = 0;
    for (const r of due) {
      const a = await this.account(r.platform);
      const provider = PROVIDER[r.platform];
      const app = provider && this.app(provider);
      if (!a || !app) continue;
      try {
        const fresh = await this.api.refresh(a, app);
        if (!fresh) continue;
        await this.db.query(
          "UPDATE social_accounts SET secret = $2, expires_at = $3, refreshed_at = $4 WHERE platform = $1",
          [r.platform, this.seal(fresh.secret), fresh.expiresAt, now],
        );
        n++;
      } catch (err) {
        this.logger.warn({ err, platform: r.platform }, "social token refresh failed");
      }
    }
    return n;
  }

  /* ───────────────────────────── media ───────────────────────────── */

  private async media(itemId: string, kind: "VIDEO" | "IMAGE"): Promise<MediaRow | null> {
    return this.db.one<MediaRow>(
      "SELECT id, mime, bytes FROM content_media WHERE item_id = $1 AND kind = $2",
      [itemId, kind],
    );
  }

  private async store(
    itemId: string,
    kind: "VIDEO" | "IMAGE",
    mime: string,
    bytes: Buffer,
  ): Promise<MediaRow> {
    return (await row<MediaRow>(
      this.db.pool,
      `INSERT INTO content_media (item_id, kind, mime, bytes, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (item_id, kind) DO UPDATE SET mime = $3, bytes = $4, created_at = $5
       RETURNING id, mime, bytes`,
      [itemId, kind, mime, bytes, this.clock.now()],
    ))!;
  }

  /** The item's card as JPEG (PNG where ffmpeg is missing; Instagram then cannot post). */
  private async image(item: ItemRow): Promise<MediaRow> {
    const have = await this.media(item.id, "IMAGE");
    if (have) return have;
    const raceId = raceIdOf(item.kind, item.payload);
    let png: Buffer;
    if (raceId) png = await this.share.raceImage(raceId);
    else {
      const p = item.payload as WeeklyTopPayload;
      png = renderPng(
        tableCardSvg({
          title: "Top of the week",
          subtitle: "Highest-rated racehorses in training",
          rows: p.rows.map((r) => ({ name: r.name, detail: `${r.rating} · ${r.wins}W/${r.starts}` })),
        }),
      );
    }
    return (await ffmpegAvailable())
      ? this.store(item.id, "IMAGE", "image/jpeg", await pngToJpeg(png))
      : this.store(item.id, "IMAGE", "image/png", png);
  }

  /** The item's race video (rendered once, kept for a week). */
  async video(item: ItemRow): Promise<MediaRow | null> {
    const raceId = raceIdOf(item.kind, item.payload);
    if (!raceId) return null;
    const have = await this.media(item.id, "VIDEO");
    if (have) return have;
    if (!(await ffmpegAvailable())) return null;
    const [race, live] = await Promise.all([this.share.race(raceId), this.share.live(raceId)]);
    if (!live.frames) return null;
    const byHorse = new Map(race.entryList.map((e) => [e.horseId, e]));
    const lines = videoLines(item.kind, item.payload);
    const winner = race.entryList.find((e) => e.position === 1);
    const input: RaceVideoInput = {
      headline: lines.headline,
      raceName: race.name,
      meta: `${race.trackName} · ${race.distance}m ${lower(race.surface)} · ${lower(race.going)}`,
      distance: race.distance,
      frames: live.frames,
      runners: live.frames.ids.map((id) => {
        const e = byHorse.get(id);
        return {
          id,
          name: e?.horseName ?? "",
          gate: e?.gate ?? null,
          silks: e?.silks ?? null,
          position: e?.position ?? null,
        };
      }),
      winnerLine: winner ? lines.winnerLine : "",
      handle: `@${await this.marketing.botName()}`,
    };
    const started = Date.now();
    const mp4 = await renderRaceVideo(input, this.videoFps);
    this.logger.info({ item: item.id, ms: Date.now() - started, bytes: mp4.length }, "race video rendered");
    return this.store(item.id, "VIDEO", "video/mp4", mp4);
  }

  /** A stored media file for the public route (the networks fetch from it). */
  async mediaFile(id: string): Promise<{ mime: string; bytes: Buffer } | null> {
    return this.db.one<{ mime: string; bytes: Buffer }>(
      "SELECT mime, bytes FROM content_media WHERE id = $1",
      [id],
    );
  }

  private mediaUrl(m: MediaRow): string {
    const ext = m.mime === "video/mp4" ? "mp4" : m.mime === "image/jpeg" ? "jpg" : "png";
    return `${this.apiUrl() ?? ""}/public/media/${m.id}.${ext}`;
  }

  /** Admin preview: render (if needed) and return the video's address. */
  async previewVideo(itemId: string): Promise<{ url: string }> {
    const item = await this.db.one<ItemRow>("SELECT * FROM content_items WHERE id = $1", [itemId]);
    if (!item) throw notFound("Post");
    if (!raceIdOf(item.kind, item.payload))
      throw badRequest("NO_VIDEO", "This kind of post has no race video");
    if (!(await ffmpegAvailable())) throw conflict("NO_FFMPEG", "ffmpeg is not installed on the server");
    const v = await this.video(item);
    if (!v) throw conflict("NO_VIDEO", "The race has no recording to film");
    return { url: this.mediaUrl(v) };
  }

  /* ───────────────────────────── publishing ───────────────────────────── */

  /** Which kinds a network gets: YouTube only those with a race video. */
  private kinds(platform: SocialPlatform): PostKind[] {
    const on = POST_KINDS.filter((k) => this.cfg().kinds[k]);
    return platform === "YOUTUBE" ? on.filter((k) => RACE_KINDS.includes(k)) : on;
  }

  private async postedToday(
    platform: SocialPlatform,
    now: Date,
  ): Promise<{ count: number; last: Date | null }> {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return (await this.db.one<{ count: number; last: Date | null }>(
      `SELECT count(*) FILTER (WHERE published_at >= $2)::int AS count, max(published_at) AS last
         FROM social_posts WHERE platform = $1 AND status = 'PUBLISHED'`,
      [platform, dayStart],
    ))!;
  }

  private async paused(platform: SocialPlatform): Promise<{ reason: string; at: Date } | null> {
    const r = await this.db.one<{ paused_reason: string | null; paused_at: Date | null }>(
      "SELECT paused_reason, paused_at FROM marketing_channels WHERE channel = $1",
      [platform],
    );
    return r?.paused_reason ? { reason: r.paused_reason, at: r.paused_at! } : null;
  }

  /**
   * The background loop's entry from the job runner: returns at once and posts in the
   * background (rendering a video takes a while and must not hold up races).
   */
  kick(): number {
    const now = Date.now();
    if (this.running || now - this.lastRun < EVERY_MS) return 0;
    this.lastRun = now;
    void this.tick().catch((err) => this.logger.error({ err }, "social posting failed"));
    return 0;
  }

  /** One round: housekeeping, then at most one post on one network. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = this.clock.now();
      if (now.getTime() - this.lastHousekeeping > 6 * HOUR) {
        this.lastHousekeeping = now.getTime();
        await this.db.query("DELETE FROM content_media WHERE created_at < $1", [
          new Date(now.getTime() - MEDIA_TTL),
        ]);
        await this.refreshDue();
      }
      for (const p of SOCIAL_PLATFORMS) if (await this.publishOn(p, false)) return 1;
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Post the best waiting item on a network if its switches, window, limit and gap allow. */
  async publishOn(platform: SocialPlatform, force: boolean): Promise<boolean> {
    const m = this.cfg();
    const s = m.social;
    if (!m.enabled || !s.enabled || !s.platforms[platform]) return false;
    if (this.missing(platform).length) return false;
    const account = await this.account(platform);
    if (!account) return false;
    if (await this.paused(platform)) return false;
    const now = this.clock.now();
    const h = now.getUTCHours();
    if (!force && (h < s.fromHourUtc || h >= s.toHourUtc)) return false;
    const posted = await this.postedToday(platform, now);
    if (posted.count >= s.maxPerDay) return false;
    if (!force && posted.last && now.getTime() - posted.last.getTime() < s.minGapMinutes * 60_000)
      return false;
    const ffmpeg = await ffmpegAvailable();
    if (!ffmpeg && (platform === "YOUTUBE" || platform === "INSTAGRAM")) return false;
    const item = await this.db.one<ItemRow>(
      `SELECT ci.* FROM content_items ci
        WHERE ci.expires_at > $1 AND ci.skipped_by IS NULL AND ci.created_at > $2 AND ci.kind = ANY($3::text[])
          AND NOT EXISTS (SELECT 1 FROM social_posts sp WHERE sp.item_id = ci.id AND sp.platform = $4
                           AND (sp.status <> 'PENDING' OR sp.attempts >= $5))
        ORDER BY ci.priority DESC, ci.created_at LIMIT 1`,
      [now, new Date(now.getTime() - 2 * DAY), this.kinds(platform), platform, MAX_ATTEMPTS],
    );
    if (!item) return false;
    await this.db.query(
      `INSERT INTO social_posts (item_id, platform, attempts, created_at) VALUES ($1, $2, 1, $3)
       ON CONFLICT (item_id, platform) DO UPDATE SET attempts = social_posts.attempts + 1`,
      [item.id, platform, now],
    );
    try {
      const raceId = raceIdOf(item.kind, item.payload);
      const camp = SOCIAL_CAMPAIGNS[platform];
      await this.marketing.ensureCampaign(camp.code, camp.name, camp.platform, "Own account");
      const link = await this.marketing.playLink(camp.code, raceId);
      const bot = await this.marketing.botName();
      // Bluesky and Facebook/Threads cards are fine as images; YouTube needs the video.
      const video = platform === "BLUESKY" ? null : await this.video(item);
      if (platform === "YOUTUBE" && !video) throw new Error("No race video for this post");
      const image = await this.image(item);
      const done = await this.api.publish(
        account,
        {
          text: socialCaption(item.kind, item.payload, Number(item.id), platform, { link, bot }),
          title: socialTitle(item.kind, item.payload),
          tags: SOCIAL_TAGS,
          link: { text: "▶ Play free in Telegram", url: link },
          video: video ? { url: this.mediaUrl(video), bytes: video.bytes } : null,
          image: {
            url: this.mediaUrl(image),
            bytes: image.bytes,
            width: OG_WIDTH,
            height: OG_HEIGHT,
            alt: "Thoroughline race result card",
          },
        },
        this.app(PROVIDER[platform] ?? "GOOGLE") ?? { clientId: "", clientSecret: "" },
      );
      await this.db.query(
        `UPDATE social_posts SET status = 'PUBLISHED', published_at = $3, external_id = $4, url = $5, last_error = NULL
          WHERE item_id = $1 AND platform = $2`,
        [item.id, platform, now, done.id, done.url],
      );
      await this.db.query("UPDATE marketing_channels SET consecutive_failures = 0 WHERE channel = $1", [
        platform,
      ]);
      return true;
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      this.logger.warn({ err, item: item.id, platform }, "social post failed");
      await this.db.query(
        `UPDATE social_posts SET last_error = $3, status = CASE WHEN attempts >= $4 THEN 'FAILED' ELSE status END
          WHERE item_id = $1 AND platform = $2`,
        [item.id, platform, msg, MAX_ATTEMPTS],
      );
      await this.marketing.failed(platform, LABEL[platform], msg, now);
      return false;
    }
  }

  /* ───────────────────────────── admin ───────────────────────────── */

  async view(): Promise<SocialAdminDto> {
    const now = this.clock.now();
    const s = this.cfg().social;
    const ffmpeg = await ffmpegAvailable();
    const bot = await this.marketing.botName().catch(() => null);
    const platforms: SocialPlatformDto[] = [];
    for (const p of SOCIAL_PLATFORMS) {
      const a = await this.account(p);
      const stored =
        p === "BLUESKY" ? null : await this.db.one("SELECT 1 FROM social_accounts WHERE platform = $1", [p]);
      const posted = await this.postedToday(p, now);
      const paused = await this.paused(p);
      const recent = await this.db.query<{
        item_id: string;
        kind: PostKind;
        status: "PENDING" | "PUBLISHED" | "FAILED";
        url: string | null;
        last_error: string | null;
        attempts: number;
        at: Date;
      }>(
        `SELECT sp.item_id, ci.kind, sp.status, sp.url, sp.last_error, sp.attempts,
                COALESCE(sp.published_at, sp.created_at) AS at
           FROM social_posts sp JOIN content_items ci ON ci.id = sp.item_id
          WHERE sp.platform = $1 ORDER BY COALESCE(sp.published_at, sp.created_at) DESC LIMIT 10`,
        [p],
      );
      const camp = SOCIAL_CAMPAIGNS[p];
      platforms.push({
        platform: p,
        enabled: s.platforms[p],
        connect: PROVIDER[p] ? "OAUTH" : "SERVER",
        missing: this.missing(p),
        account: a
          ? {
              id: a.accountId,
              name: a.name,
              connectedAt: a.connectedAt?.toISOString() ?? null,
              expiresAt: a.expiresAt?.toISOString() ?? null,
              error: this.checks.get(p) ?? null,
            }
          : stored
            ? {
                id: "",
                name: "",
                connectedAt: null,
                expiresAt: null,
                error: "Saved under another server secret: connect again",
              }
            : null,
        needsFfmpeg: p === "YOUTUBE" || p === "INSTAGRAM",
        kinds: this.kinds(p),
        publishedToday: posted.count,
        lastPublishedAt: posted.last?.toISOString() ?? null,
        paused: paused ? { reason: paused.reason, at: paused.at.toISOString() } : null,
        campaign: camp.code,
        bioLink: bot
          ? `https://t.me/${bot}/${this.env.TELEGRAM_APP_SHORT_NAME || "play"}?startapp=c_${camp.code}`
          : null,
        recent: recent.map((r) => ({
          itemId: r.item_id,
          kind: r.kind,
          status: r.status,
          url: r.url,
          error: r.last_error,
          attempts: r.attempts,
          at: r.at.toISOString(),
        })),
      });
    }
    return {
      enabled: s.enabled,
      maxPerDay: s.maxPerDay,
      minGapMinutes: s.minGapMinutes,
      window: [s.fromHourUtc, s.toHourUtc],
      ffmpeg,
      apiUrl: this.apiUrl(),
      redirectUris: {
        GOOGLE: this.redirectUri("GOOGLE"),
        META: this.redirectUri("META"),
        THREADS: this.redirectUri("THREADS"),
      },
      platforms,
    };
  }

  async setSwitch(
    actorId: string,
    key: "ALL" | SocialPlatform,
    enabled: boolean,
    note: string | undefined,
    ip: string | null,
  ): Promise<SocialAdminDto> {
    const path =
      key === "ALL" ? ["marketing", "social", "enabled"] : ["marketing", "social", "platforms", key];
    await this.switches.set(path, SWITCH_ACTION, {
      actorId,
      enabled,
      note:
        note ||
        `Posting to ${key === "ALL" ? "other networks" : LABEL[key]} switched ${enabled ? "on" : "off"}`,
      ip,
    });
    return this.view();
  }

  async resume(actorId: string, platform: SocialPlatform, ip: string | null): Promise<SocialAdminDto> {
    await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE marketing_channels SET paused_reason = NULL, paused_at = NULL, consecutive_failures = 0
          WHERE channel = $1 AND paused_reason IS NOT NULL RETURNING channel`,
        [platform],
      );
      if (!r.rows.length) throw conflict("NOT_PAUSED", "Posting is not paused");
      await c.query(
        `INSERT INTO audit_logs (actor_id, action, target_type, target_id, reason, ip)
         VALUES ($1, 'MARKETING_RESUMED', 'marketing', $2, 'Posting resumed', $3)`,
        [actorId, platform, ip],
      );
    });
    return this.view();
  }
}

const lower = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** The small page a network's sign-in returns to (opened in the admin's browser). */
function page(title: string, message: string): string {
  const e = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · Thoroughline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0a09;color:#fafaf9;font:16px/1.5 system-ui,sans-serif;padding:16px}main{max-width:28rem}h1{color:#e0b43a;font-size:1.4rem}</style></head>
<body><main><h1>${e(title)}</h1><p>${e(message)}</p></main></body></html>`;
}
