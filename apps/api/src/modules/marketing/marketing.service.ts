import { Inject, Injectable } from "@nestjs/common";
import type { MarketingAdminDto, MarketingItemDto } from "@thoroughline/contracts";
import { trackByCode } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { ConfigSwitchService } from "../../common/config-switch.js";
import { Db, row, rows } from "../../common/db.js";
import { badRequest, conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { ENV, type Env } from "../../config/env.js";
import { ShareService } from "../share/share.service.js";
import { renderPng, tableCardSvg } from "../share/og-image.js";
import { BOT_API, type BotApi, type InlineWebAppButton } from "../telegram/bot-api.js";
import {
  caption,
  type ChampionPayload,
  type FirstWinPayload,
  POST_CAMPAIGNS,
  POST_KINDS,
  POST_PRIORITY,
  type PostKind,
  type RaceOfDayPayload,
  type WeeklyTopPayload,
} from "./posts.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CHANNEL = "TELEGRAM";
/** Failed attempts on one post before it is given up. */
const MAX_ATTEMPTS = 3;
/** Consecutive channel failures before posting pauses itself and the team is told. */
const PAUSE_AFTER = 3;
/** "Race of the day" is picked once the day's racing is well under way. */
const RACE_OF_DAY_FROM_HOUR = 15;
/** "Top of the week" goes out on Mondays from this hour (UTC). */
const WEEKLY_FROM_HOUR = 9;

export const SWITCH_ACTION = "MARKETING_SWITCH";
const SETTING_ACTION = "MARKETING_SETTING";

interface ItemRow {
  id: string;
  kind: PostKind;
  payload: unknown;
  status: MarketingItemDto["status"];
  attempts: number;
  last_error: string | null;
  external_id: string | null;
  created_at: Date;
  expires_at: Date;
  published_at: Date | null;
}

/**
 * Automatic posts about real game events to the game's own Telegram channel: detectors queue
 * one item per event (race of the day, tournament champion, a horse's first win, top of the
 * week); the publisher posts the best queued item within the window and limits, with a card
 * image and buttons that carry the post's campaign code. Every kind, the channel and the whole
 * thing have admin kill switches; repeated failures pause the channel and alert the team.
 * Nothing goes anywhere but the configured own channel; no personal data (stables only with
 * their owner's consent, never Telegram names).
 */
@Injectable()
export class MarketingService {
  private status: { at: number; channel: string; value: MarketingAdminDto["telegram"]["status"] } | null =
    null;
  private botUsername: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly switches: ConfigSwitchService,
    private readonly share: ShareService,
    private readonly events: EventsService,
    private readonly clock: Clock,
    @Inject(BOT_API) private readonly bot: BotApi,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  private cfg() {
    return this.config.get().marketing;
  }

  private on(): boolean {
    const m = this.cfg();
    return m.enabled && m.telegram.enabled;
  }

  /* ───────────────────────────── detectors ───────────────────────────── */

  /** Queue posts for new events (idempotent: one item per event key). */
  async detect(): Promise<number> {
    const m = this.cfg();
    // The queue feeds the channel and the other networks alike.
    if (!m.enabled || (!m.telegram.enabled && !m.social.enabled)) return 0;
    const now = this.clock.now();
    const kinds = this.cfg().kinds;
    let n = 0;
    if (kinds.RACE_OF_THE_DAY) n += await this.raceOfTheDay(now);
    if (kinds.TOURNAMENT_CHAMPION) n += await this.champions(now);
    if (kinds.FIRST_WIN) n += await this.firstWin(now);
    if (kinds.WEEKLY_TOP) n += await this.weeklyTop(now);
    return n;
  }

  private async queue(
    kind: PostKind,
    key: string,
    payload: unknown,
    now: Date,
    ttlMs: number,
  ): Promise<number> {
    const r = await this.db.query(
      `INSERT INTO content_items (kind, dedupe_key, payload, priority, channel, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [
        kind,
        key,
        JSON.stringify(payload),
        POST_PRIORITY[kind],
        CHANNEL,
        now,
        new Date(now.getTime() + ttlMs),
      ],
    );
    return r.length;
  }

  /** Stable names that may be shown publicly (owner's consent). */
  private async publicStable(ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;
    const r = await this.db.one<{ name: string }>(
      `SELECT s.name FROM stables s JOIN users u ON u.id = s.owner_id
        WHERE s.owner_id = $1 AND (u.settings->>'publicStable') = 'true'`,
      [ownerId],
    );
    return r?.name ?? null;
  }

  /**
   * The day's most watchable finished race: a close finish, an upset (the winner was low in the
   * pre-race ability order), a player's horse winning, a tournament final.
   */
  private async raceOfTheDay(now: Date): Promise<number> {
    if (now.getUTCHours() < RACE_OF_DAY_FROM_HOUR) return 0;
    const day = now.toISOString().slice(0, 10);
    if (await this.db.one("SELECT 1 FROM content_items WHERE dedupe_key = $1", [`raceday:${day}`])) return 0;
    const entries = await this.db.query<{
      race_id: string;
      race_name: string;
      distance: number;
      going: string;
      track_code: string;
      stage: string | null;
      horse_name: string;
      is_house: boolean;
      position: number | null;
      lengths_behind: string | null;
      ability: string | null;
    }>(
      `SELECT r.id AS race_id, r.name AS race_name, r.distance, r.going, r.track_code, r.stage,
              COALESCE(e.snapshot->>'name', h.name) AS horse_name, e.is_house, e.position, e.lengths_behind,
              e.snapshot->>'abilityRating' AS ability
         FROM races r JOIN race_entries e ON e.race_id = r.id AND e.status = 'RAN' JOIN horses h ON h.id = e.horse_id
        WHERE r.status = 'COMPLETED' AND r.completed_at > $1 AND r.completed_at <= $2
          AND r.id IN (SELECT race_id FROM race_entries WHERE NOT is_house AND status = 'RAN')`,
      [new Date(now.getTime() - DAY), now],
    );
    const byRace = new Map<string, typeof entries>();
    for (const e of entries) byRace.set(e.race_id, [...(byRace.get(e.race_id) ?? []), e]);
    let best: { score: number; payload: RaceOfDayPayload } | null = null;
    for (const list of byRace.values()) {
      if (list.length < 4) continue;
      const winner = list.find((e) => e.position === 1);
      if (!winner) continue;
      const second = list.find((e) => e.position === 2);
      const margin = second?.lengths_behind === null || !second ? null : Number(second.lengths_behind);
      const order = [...list].sort((a, b) => Number(b.ability ?? 0) - Number(a.ability ?? 0));
      const expectedRank = order.indexOf(winner) + 1;
      const score =
        (margin === null ? 0 : Math.max(0, 2 - margin)) +
        (2 * (expectedRank - 1)) / (list.length - 1) +
        (winner.is_house ? 0 : 1) +
        (winner.stage === "FINAL" ? 1 : 0);
      if (!best || score > best.score)
        best = {
          score,
          payload: {
            raceId: winner.race_id,
            raceName: winner.race_name,
            winner: winner.horse_name,
            winnerHouse: winner.is_house,
            margin,
            expectedRank,
            field: list.length,
            distance: winner.distance,
            going: winner.going,
            trackName: trackByCode(winner.track_code).name,
          },
        };
    }
    return best ? this.queue("RACE_OF_THE_DAY", `raceday:${day}`, best.payload, now, 12 * HOUR) : 0;
  }

  private async champions(now: Date): Promise<number> {
    const list = await this.db.query<{
      id: string;
      name: string;
      final_race_id: string;
      track_code: string;
      distance: number;
      winner_owner_id: string | null;
      horse_name: string;
      entrants: number;
    }>(
      `SELECT t.id, t.name, t.final_race_id, t.track_code, t.distance, t.winner_owner_id, h.name AS horse_name,
              (SELECT count(*)::int FROM tournament_entries e WHERE e.tournament_id = t.id AND e.status <> 'WITHDRAWN') AS entrants
         FROM tournaments t JOIN horses h ON h.id = t.winner_horse_id
        WHERE t.status = 'COMPLETED' AND t.completed_at > $1 AND t.final_race_id IS NOT NULL`,
      [new Date(now.getTime() - 2 * DAY)],
    );
    let n = 0;
    for (const t of list) {
      const payload: ChampionPayload = {
        tournamentId: t.id,
        name: t.name,
        finalRaceId: t.final_race_id,
        winner: t.horse_name,
        winnerHouse: !t.winner_owner_id,
        stable: await this.publicStable(t.winner_owner_id),
        entrants: t.entrants,
        distance: t.distance,
        trackName: trackByCode(t.track_code).name,
      };
      n += await this.queue("TOURNAMENT_CHAMPION", `champ:${t.id}`, payload, now, DAY);
    }
    return n;
  }

  /** One maiden-breaking win a day: the latest player's horse to win for the first time. */
  private async firstWin(now: Date): Promise<number> {
    const day = now.toISOString().slice(0, 10);
    const w = await this.db.one<{
      race_id: string;
      race_name: string;
      distance: number;
      horse_name: string;
      owner_id: string;
      field: number;
    }>(
      `SELECT r.id AS race_id, r.name AS race_name, r.distance, COALESCE(e.snapshot->>'name', h.name) AS horse_name,
              e.owner_id, (SELECT count(*)::int FROM race_entries x WHERE x.race_id = r.id AND x.status = 'RAN') AS field
         FROM race_entries e JOIN races r ON r.id = e.race_id JOIN horses h ON h.id = e.horse_id
        WHERE e.position = 1 AND e.status = 'RAN' AND NOT e.is_house AND r.status = 'COMPLETED'
          AND r.completed_at > $1 AND r.completed_at <= $2
          AND NOT EXISTS (SELECT 1 FROM race_entries p JOIN races pr ON pr.id = p.race_id
                           WHERE p.horse_id = e.horse_id AND p.position = 1 AND p.status = 'RAN'
                             AND pr.completed_at < r.completed_at)
        ORDER BY r.completed_at DESC LIMIT 1`,
      [new Date(now.getTime() - DAY), now],
    );
    if (!w) return 0;
    const payload: FirstWinPayload = {
      raceId: w.race_id,
      raceName: w.race_name,
      horse: w.horse_name,
      stable: await this.publicStable(w.owner_id),
      field: w.field,
      distance: w.distance,
    };
    return this.queue("FIRST_WIN", `firstwin:${day}`, payload, now, 12 * HOUR);
  }

  private async weeklyTop(now: Date): Promise<number> {
    if (now.getUTCDay() !== 1 || now.getUTCHours() < WEEKLY_FROM_HOUR) return 0;
    const week = now.toISOString().slice(0, 10);
    const top = await this.db.query<{
      id: string;
      name: string;
      race_rating: number;
      wins: number;
      starts: number;
    }>(
      `SELECT id, name, race_rating, wins, starts FROM horses
        WHERE owner_id IS NOT NULL AND retired_at IS NULL AND starts > 0
        ORDER BY race_rating DESC, wins DESC, id LIMIT 5`,
    );
    if (top.length < 3) return 0;
    const payload: WeeklyTopPayload = {
      week,
      rows: top.map((h) => ({
        horseId: h.id,
        name: h.name,
        rating: h.race_rating,
        wins: h.wins,
        starts: h.starts,
      })),
    };
    return this.queue("WEEKLY_TOP", `week:${week}`, payload, now, DAY);
  }

  /* ───────────────────────────── publishing ───────────────────────────── */

  private async channelState(): Promise<{
    paused_reason: string | null;
    paused_at: Date | null;
    consecutive_failures: number;
  }> {
    await this.db.query("INSERT INTO marketing_channels (channel) VALUES ($1) ON CONFLICT DO NOTHING", [
      CHANNEL,
    ]);
    return (await this.db.one("SELECT * FROM marketing_channels WHERE channel = $1", [CHANNEL]))!;
  }

  private async postedToday(now: Date): Promise<{ count: number; last: Date | null }> {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const r = (await this.db.one<{ count: number; last: Date | null }>(
      `SELECT count(*) FILTER (WHERE published_at >= $2)::int AS count, max(published_at) AS last
         FROM content_items WHERE channel = $1 AND status = 'PUBLISHED'`,
      [CHANNEL, dayStart],
    ))!;
    return r;
  }

  /**
   * Post the best queued item if the window, daily limit and gap allow it. `force` (an admin's
   * "publish next now") skips the window and gap, never the switches or the daily limit.
   */
  async publish(force = false): Promise<number> {
    const now = this.clock.now();
    await this.db.query(
      "UPDATE content_items SET status = 'SKIPPED', last_error = 'expired' WHERE status = 'QUEUED' AND expires_at <= $1",
      [now],
    );
    if (!this.on() || !this.bot.enabled) return 0;
    const m = this.cfg().telegram;
    const state = await this.channelState();
    if (state.paused_reason) return 0;
    const h = now.getUTCHours();
    if (!force && (h < m.fromHourUtc || h >= m.toHourUtc)) return 0;
    const posted = await this.postedToday(now);
    if (posted.count >= m.maxPerDay) return 0;
    if (!force && posted.last && now.getTime() - posted.last.getTime() < m.minGapMinutes * 60_000) return 0;
    const kinds = this.cfg().kinds;
    const enabled = POST_KINDS.filter((k) => kinds[k]);
    const item = await row<ItemRow>(
      this.db.pool,
      `UPDATE content_items SET attempts = attempts + 1
        WHERE id = (SELECT id FROM content_items
                     WHERE channel = $1 AND status = 'QUEUED' AND expires_at > $2 AND kind = ANY($3::text[])
                     ORDER BY priority DESC, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [CHANNEL, now, enabled],
    );
    if (!item) return 0;
    try {
      const { image, text, buttons } = await this.render(item);
      const messageId = await this.bot.sendPhoto(m.channel, image, text, buttons);
      await this.db.query(
        "UPDATE content_items SET status = 'PUBLISHED', published_at = $2, external_id = $3, last_error = NULL WHERE id = $1",
        [item.id, now, String(messageId)],
      );
      await this.db.query("UPDATE marketing_channels SET consecutive_failures = 0 WHERE channel = $1", [
        CHANNEL,
      ]);
      return 1;
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      this.logger.warn({ err, item: item.id }, "marketing post failed");
      await this.db.query(
        `UPDATE content_items SET last_error = $2, status = CASE WHEN attempts >= $3 THEN 'FAILED' ELSE status END
          WHERE id = $1`,
        [item.id, msg, MAX_ATTEMPTS],
      );
      await this.failed(CHANNEL, this.cfg().telegram.channel, msg, now);
      return 0;
    }
  }

  /**
   * Count a failure on a channel (Telegram or a network); after a few in a row pause posting
   * there and tell the team once. `label` names it in the alert.
   */
  async failed(channel: string, label: string, reason: string, now: Date): Promise<void> {
    await this.db.query("INSERT INTO marketing_channels (channel) VALUES ($1) ON CONFLICT DO NOTHING", [
      channel,
    ]);
    const s = await row<{ consecutive_failures: number }>(
      this.db.pool,
      "UPDATE marketing_channels SET consecutive_failures = consecutive_failures + 1 WHERE channel = $1 RETURNING consecutive_failures",
      [channel],
    );
    if ((s?.consecutive_failures ?? 0) < PAUSE_AFTER) return;
    await this.db.tx(async (c) => {
      const paused = await c.query(
        `UPDATE marketing_channels SET paused_reason = $2, paused_at = $3, alerted_at = $3
          WHERE channel = $1 AND paused_reason IS NULL RETURNING channel`,
        [channel, reason, now],
      );
      if (!paused.rows.length) return;
      const admins = await rows<{ id: string }>(
        c,
        "SELECT id FROM users WHERE role IN ('SUPER_ADMIN','CONTENT_ADMIN','ECONOMY_ADMIN') AND status = 'ACTIVE'",
      );
      for (const a of admins)
        await this.events.emit(c, {
          type: "marketing_alert",
          aggregateType: "marketing",
          aggregateId: channel,
          payload: { userId: a.id, channel: label, reason },
        });
    });
  }

  /** The campaign the system's own posts link through (created on first use, no human author). */
  async ensureCampaign(code: string, name: string, platform: string, partner = "Own channel"): Promise<void> {
    await this.db.query(
      `INSERT INTO campaigns (code, name, partner, platform, note, created_by, created_at)
       VALUES ($1, $2, $3, $4, 'Created automatically for the game''s own posts', NULL, $5)
       ON CONFLICT (code) DO NOTHING`,
      [code, name, partner, platform, this.clock.now()],
    );
  }

  /** The bot's @username (configured, or asked from Telegram once). */
  async botName(): Promise<string> {
    return this.env.TELEGRAM_BOT_USERNAME || (this.botUsername ??= (await this.bot.getMe()).username);
  }

  /** A Mini App link carrying a campaign (and opening the race's replay when given). */
  async playLink(code: string, raceId: string | null): Promise<string> {
    const app = this.env.TELEGRAM_APP_SHORT_NAME || "play";
    const start = raceId ? `race_${raceId}_c${code}` : `c_${code}`;
    return `https://t.me/${await this.botName()}/${app}?startapp=${start}`;
  }

  private async links(kind: PostKind, raceId: string | null): Promise<InlineWebAppButton[][]> {
    const code = POST_CAMPAIGNS[kind].code;
    await this.ensureCampaign(code, POST_CAMPAIGNS[kind].name, "TELEGRAM");
    const play: InlineWebAppButton = { text: "🏇 Play free", url: await this.playLink(code, raceId) };
    const web = this.env.WEBAPP_URL?.replace(/\/$/, "");
    if (!raceId || !web) return [[play]];
    return [[{ text: "▶️ Watch the replay", url: `${web}/replay/?id=${raceId}&c=${code}` }, play]];
  }

  private async render(
    item: ItemRow,
  ): Promise<{ image: Buffer; text: string; buttons: InlineWebAppButton[][] }> {
    const variant = Number(item.id);
    const text = caption(item.kind, item.payload, variant);
    switch (item.kind) {
      case "RACE_OF_THE_DAY":
      case "FIRST_WIN": {
        const raceId = (item.payload as RaceOfDayPayload | FirstWinPayload).raceId;
        return {
          image: await this.share.raceImage(raceId),
          text,
          buttons: await this.links(item.kind, raceId),
        };
      }
      case "TOURNAMENT_CHAMPION": {
        const raceId = (item.payload as ChampionPayload).finalRaceId;
        return {
          image: await this.share.raceImage(raceId),
          text,
          buttons: await this.links(item.kind, raceId),
        };
      }
      case "WEEKLY_TOP": {
        const p = item.payload as WeeklyTopPayload;
        const image = renderPng(
          tableCardSvg({
            title: "Top of the week",
            subtitle: "Highest-rated racehorses in training",
            rows: p.rows.map((r) => ({ name: r.name, detail: `${r.rating} · ${r.wins}W/${r.starts}` })),
          }),
        );
        return { image, text, buttons: await this.links(item.kind, null) };
      }
    }
  }

  /* ───────────────────────────── admin ───────────────────────────── */

  /** Can the bot post to the configured channel? (cached for two minutes) */
  async channelStatus(force = false): Promise<MarketingAdminDto["telegram"]["status"]> {
    const channel = this.cfg().telegram.channel;
    if (!force && this.status && this.status.channel === channel && Date.now() - this.status.at < 2 * 60_000)
      return this.status.value;
    const value = await this.checkChannel(channel);
    this.status = { at: Date.now(), channel, value };
    return value;
  }

  /** Ask Telegram whether the bot is an admin of `channel` allowed to post. */
  private async checkChannel(channel: string): Promise<MarketingAdminDto["telegram"]["status"]> {
    let value: MarketingAdminDto["telegram"]["status"];
    try {
      if (!this.bot.enabled) throw new Error("The bot token is not configured");
      const me = await this.bot.getMe();
      const chat = await this.bot.getChat(channel);
      const member = await this.bot.getChatMember(chat.id, me.id);
      const admin = member.status === "administrator" || member.status === "creator";
      value =
        admin && member.can_post_messages !== false
          ? { ok: true, title: chat.title ?? channel, error: null }
          : {
              ok: false,
              title: chat.title ?? channel,
              error: "The bot is not an admin allowed to post in this channel",
            };
    } catch (err) {
      value = { ok: false, title: null, error: (err as Error).message.replace(/^Telegram \w+ failed: /, "") };
    }
    return value;
  }

  private itemDto(r: ItemRow): MarketingItemDto {
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      caption: caption(r.kind, r.payload, Number(r.id)),
      attempts: r.attempts,
      lastError: r.last_error,
      externalId: r.external_id,
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      publishedAt: r.published_at?.toISOString() ?? null,
    };
  }

  async view(): Promise<MarketingAdminDto> {
    const now = this.clock.now();
    const m = this.cfg();
    const state = await this.channelState();
    const posted = await this.postedToday(now);
    const queue = await rows<ItemRow>(
      this.db.pool,
      `SELECT * FROM content_items WHERE channel = $1 AND status = 'QUEUED' AND expires_at > $2
        ORDER BY priority DESC, created_at LIMIT 20`,
      [CHANNEL, now],
    );
    const recent = await rows<ItemRow>(
      this.db.pool,
      `SELECT * FROM content_items WHERE channel = $1 AND status <> 'QUEUED'
        ORDER BY COALESCE(published_at, created_at) DESC LIMIT 20`,
      [CHANNEL],
    );
    return {
      enabled: m.enabled,
      telegram: {
        enabled: m.telegram.enabled,
        channel: m.telegram.channel,
        maxPerDay: m.telegram.maxPerDay,
        minGapMinutes: m.telegram.minGapMinutes,
        window: [m.telegram.fromHourUtc, m.telegram.toHourUtc],
        publishedToday: posted.count,
        lastPublishedAt: posted.last?.toISOString() ?? null,
        paused: state.paused_reason
          ? { reason: state.paused_reason, at: state.paused_at!.toISOString() }
          : null,
        status: await this.channelStatus(),
        links: { web: !!this.env.WEBAPP_URL, bot: this.env.TELEGRAM_BOT_USERNAME || null },
      },
      kinds: { ...m.kinds },
      campaigns: Object.fromEntries(POST_KINDS.map((k) => [k, POST_CAMPAIGNS[k].code])) as Record<
        PostKind,
        string
      >,
      queue: queue.map((r) => this.itemDto(r)),
      recent: recent.map((r) => this.itemDto(r)),
      history: await this.switches.history(SWITCH_ACTION),
    };
  }

  async setSwitch(
    actorId: string,
    key: "ALL" | "TELEGRAM" | PostKind,
    enabled: boolean,
    note: string | undefined,
    ip: string | null,
  ): Promise<MarketingAdminDto> {
    const path =
      key === "ALL"
        ? ["marketing", "enabled"]
        : key === "TELEGRAM"
          ? ["marketing", "telegram", "enabled"]
          : ["marketing", "kinds", key];
    await this.switches.set(path, SWITCH_ACTION, {
      actorId,
      enabled,
      note: note || `Marketing ${key.toLowerCase()} switched ${enabled ? "on" : "off"}`,
      ip,
    });
    return this.view();
  }

  /** Point posting at another channel (checked first: the bot must be able to post there). */
  async setChannel(actorId: string, channel: string, note: string | undefined, ip: string | null) {
    const prev = this.cfg().telegram.channel;
    // Checked before saving, so a wrong handle never replaces a working one.
    const status = await this.checkChannel(channel);
    if (!status.ok)
      throw badRequest("CHANNEL_NOT_READY", status.error ?? "The bot cannot post to this channel", {
        status,
      });
    await this.switches.setValue(["marketing", "telegram", "channel"], SETTING_ACTION, {
      actorId,
      value: channel,
      note: note || `Channel ${prev} → ${channel}`,
      ip,
    });
    this.status = null;
    return this.view();
  }

  async resume(actorId: string, ip: string | null): Promise<MarketingAdminDto> {
    await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE marketing_channels SET paused_reason = NULL, paused_at = NULL, consecutive_failures = 0
          WHERE channel = $1 AND paused_reason IS NOT NULL RETURNING channel`,
        [CHANNEL],
      );
      if (!r.rows.length) throw conflict("NOT_PAUSED", "Posting is not paused");
      await c.query(
        `INSERT INTO audit_logs (actor_id, action, target_type, target_id, reason, ip)
         VALUES ($1, 'MARKETING_RESUMED', 'marketing', $2, 'Posting resumed', $3)`,
        [actorId, CHANNEL, ip],
      );
    });
    this.status = null;
    return this.view();
  }

  async skip(actorId: string, id: string): Promise<MarketingAdminDto> {
    const r = await this.db.query(
      "UPDATE content_items SET status = 'SKIPPED', skipped_by = $2, last_error = 'skipped by an admin' WHERE id = $1 AND status = 'QUEUED' RETURNING id",
      [id, actorId],
    );
    if (!r.length) throw notFound("Queued post");
    return this.view();
  }

  /** The card image a queued or published post carries (admin preview). */
  async preview(id: string): Promise<Buffer> {
    const item = await this.db.one<ItemRow>("SELECT * FROM content_items WHERE id = $1", [id]);
    if (!item) throw notFound("Post");
    return (await this.render(item)).image;
  }
}
