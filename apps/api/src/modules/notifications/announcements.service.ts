import { Inject, Injectable } from "@nestjs/common";
import type { AnnouncementDto } from "@thoroughline/contracts";
import { trackByCode } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, rows } from "../../common/db.js";
import { conflict } from "../../common/errors.js";
import { credits, type Lang, langOf, num } from "../../common/i18n.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { ENV, type Env } from "../../config/env.js";
import { BOT_API, type BotApi, type InlineWebAppButton } from "../telegram/bot-api.js";

type Kind = AnnouncementDto["kind"];

export interface ShopHorseItem {
  horseId: string;
  name: string;
  rarity: string;
  price: number;
  endsAt: string;
}

export interface SpecialRaceItem {
  raceId: string;
  name: string;
}

interface AnnouncementRow {
  id: string;
  kind: Kind;
  items: (ShopHorseItem | SpecialRaceItem)[];
  created_at: Date;
  send_after: Date;
  started_at: Date | null;
  cursor_user: string | null;
  sent: number;
  skipped: number;
  failed: number;
  done_at: Date | null;
  cancelled_at: Date | null;
}

interface RaceItem {
  id: string;
  name: string;
  class: string;
  track_code: string;
  distance: number;
  purse: number;
  entry_fee: number;
  starts_at: Date;
  locks_at: Date;
}

/** Items created this close together go out as one message (e.g. two horses listed in a row). */
const MERGE_WINDOW_MS = 10 * 60_000;
/** Each new item waits this long for siblings before the message goes out. */
const GATHER_MS = 60_000;
const BATCH = 200;
const EVERY_MS = 30_000;

const escape = (s: unknown) =>
  String(s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

const RARITY: Record<string, { en: string; uk: string; icon: string }> = {
  LEGENDARY: { en: "Legendary", uk: "Легендарний", icon: "🌟" },
  EPIC: { en: "Epic", uk: "Епічний", icon: "💎" },
  RARE: { en: "Rare", uk: "Рідкісний", icon: "🔷" },
  UNCOMMON: { en: "Uncommon", uk: "Незвичайний", icon: "🔹" },
  COMMON: { en: "Common", uk: "Звичайний", icon: "▫️" },
};

const CLASS: Record<string, { en: string; uk: string }> = {
  MAIDEN: { en: "Maiden", uk: "Maiden (дебют)" },
  CLASS_5: { en: "Class 5", uk: "Клас 5" },
  CLASS_4: { en: "Class 4", uk: "Клас 4" },
  CLASS_3: { en: "Class 3", uk: "Клас 3" },
  CLASS_2: { en: "Class 2", uk: "Клас 2" },
  CLASS_1: { en: "Class 1", uk: "Клас 1" },
};

/** "23 h" / "45 min" until `at` (at least a minute). */
function left(at: Date, now: Date, lang: Lang): string {
  const mins = Math.max(1, Math.round((at.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return lang === "uk" ? `${mins} хв` : `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 6 || m === 0) return lang === "uk" ? `${Math.round(mins / 60)} год` : `${Math.round(mins / 60)} h`;
  return lang === "uk" ? `${h} год ${m} хв` : `${h} h ${m} min`;
}

/**
 * Tells every player in the bot when the team lists horses in the shop or creates a special race
 * from the admin console: one short message per drop (items created together are merged), in
 * the player's language, with a button into the Mini App. Only players who started the bot and
 * kept bot messages and "News and offers" on; sent in the background at a pace Telegram allows,
 * resuming after a restart; items no longer on offer (sold, ended, race closed) are left out,
 * and an announcement with nothing left is dropped. The team can stop one from the console.
 */
@Injectable()
export class AnnouncementsService {
  /** Pause between two messages (Telegram allows about 30 a second to different chats). */
  pauseMs = 45;
  private running = false;
  private lastRun = 0;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    @Inject(BOT_API) private readonly bot: BotApi,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Queue an item, merging it into an announcement of the same kind made moments ago. */
  async queue(c: Queryable, kind: Kind, item: ShopHorseItem | SpecialRaceItem, actorId: string | null) {
    const now = this.clock.now();
    const sendAfter = new Date(now.getTime() + GATHER_MS);
    const open = await c.query<{ id: string }>(
      `SELECT id FROM announcements
        WHERE kind = $1 AND started_at IS NULL AND cancelled_at IS NULL AND created_at > $2
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [kind, new Date(now.getTime() - MERGE_WINDOW_MS)],
    );
    if (open.rows[0]) {
      await c.query("UPDATE announcements SET items = items || $2::jsonb, send_after = $3 WHERE id = $1", [
        open.rows[0].id,
        JSON.stringify([item]),
        sendAfter,
      ]);
      return;
    }
    await c.query(
      "INSERT INTO announcements (kind, items, created_by, created_at, send_after) VALUES ($1, $2, $3, $4, $5)",
      [kind, JSON.stringify([item]), actorId, now, sendAfter],
    );
  }

  /** Job runner entry: returns at once, sends in the background (thousands of messages take minutes). */
  kick(): number {
    const now = Date.now();
    if (this.running || now - this.lastRun < EVERY_MS) return 0;
    this.lastRun = now;
    void this.run().catch((err) => this.logger.error({ err }, "announcements failed"));
    return 0;
  }

  /** Send every due announcement to the end. Returns the messages sent. */
  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let total = 0;
    try {
      for (;;) {
        const a = await this.db.one<AnnouncementRow>(
          `SELECT * FROM announcements WHERE done_at IS NULL AND cancelled_at IS NULL AND send_after <= $1
            ORDER BY id LIMIT 1`,
          [this.clock.now()],
        );
        if (!a) return total;
        total += await this.send(a);
      }
    } finally {
      this.running = false;
    }
  }

  /** What is still on offer: unsold horses still on sale, races still open for entries. */
  private async live(a: AnnouncementRow, now: Date): Promise<{ horses: ShopHorseItem[]; races: RaceItem[] }> {
    if (a.kind === "SHOP_HORSES") {
      const items = a.items as ShopHorseItem[];
      const ok = await this.db.query<{ id: string }>(
        `SELECT id FROM horses WHERE id = ANY($1::uuid[]) AND is_house AND sale_price IS NOT NULL
            AND (sale_ends_at IS NULL OR sale_ends_at > $2)`,
        [items.map((i) => i.horseId), new Date(now.getTime() + 10 * 60_000)],
      );
      const still = new Set(ok.map((r) => r.id));
      return { horses: items.filter((i) => still.has(i.horseId)), races: [] };
    }
    const races = await this.db.query<RaceItem>(
      `SELECT id, name, class, track_code, distance, purse, entry_fee, starts_at, locks_at FROM races
        WHERE id = ANY($1::uuid[]) AND status = 'OPEN' AND locks_at > $2 ORDER BY starts_at`,
      [(a.items as SpecialRaceItem[]).map((i) => i.raceId), new Date(now.getTime() + 5 * 60_000)],
    );
    return { horses: [], races };
  }

  private async send(a: AnnouncementRow): Promise<number> {
    let now = this.clock.now();
    if (!a.started_at)
      await this.db.query("UPDATE announcements SET started_at = $2 WHERE id = $1", [a.id, now]);
    let cursor = a.cursor_user;
    let sent = 0;
    for (;;) {
      // Re-checked every batch: a horse sold or a race closed meanwhile is no longer offered.
      const offer = await this.live(a, now);
      const recipients = await this.db.query<{
        id: string;
        telegram_id: number;
        language_code: string | null;
        settings: Record<string, unknown>;
      }>(
        `SELECT id, telegram_id, language_code, settings FROM users
          WHERE status = 'ACTIVE' AND telegram_id IS NOT NULL AND role <> 'SYSTEM'
            AND ($1::uuid IS NULL OR id > $1::uuid)
          ORDER BY id LIMIT $2`,
        [cursor, BATCH],
      );
      if (!recipients.length || (!offer.horses.length && !offer.races.length)) {
        await this.db.query(
          `UPDATE announcements SET done_at = $2,
                  cancelled_at = CASE WHEN $3 THEN $2 ELSE cancelled_at END WHERE id = $1`,
          [a.id, now, !!recipients.length],
        );
        return sent;
      }
      for (const u of recipients) {
        // Stopped from the console meanwhile?
        if (sent % 50 === 0) {
          const s = await this.db.one<{ cancelled_at: Date | null }>(
            "SELECT cancelled_at FROM announcements WHERE id = $1",
            [a.id],
          );
          if (s?.cancelled_at) return sent;
        }
        cursor = u.id;
        if (u.settings.notifications === false || u.settings.announcements === false) {
          await this.db.query(
            "UPDATE announcements SET cursor_user = $2, skipped = skipped + 1 WHERE id = $1",
            [a.id, u.id],
          );
          continue;
        }
        const lang = langOf(u.language_code, u.settings.locale);
        const m = this.message(a.kind, offer, lang, now);
        let ok = true;
        try {
          await this.bot.sendMessage(u.telegram_id, m.text, m.buttons);
          sent++;
        } catch (err) {
          ok = false;
          this.logger.debug({ err, announcement: a.id }, "announcement delivery failed");
        }
        await this.db.query(
          `UPDATE announcements SET cursor_user = $2, sent = sent + $3, failed = failed + $4 WHERE id = $1`,
          [a.id, u.id, ok ? 1 : 0, ok ? 0 : 1],
        );
        if (this.pauseMs) await new Promise((r) => setTimeout(r, this.pauseMs));
      }
      now = this.clock.now();
    }
  }

  private button(text: string, path: string): InlineWebAppButton[][] | undefined {
    const base = this.env.WEBAPP_URL?.replace(/\/$/, "");
    return base ? [[{ text, web_app: { url: `${base}${path}` } }]] : undefined;
  }

  /** The message, as a player in `lang` reads it now. */
  message(
    kind: Kind,
    offer: { horses: ShopHorseItem[]; races: RaceItem[] },
    lang: Lang,
    now: Date,
  ): { text: string; buttons?: InlineWebAppButton[][] } {
    const uk = lang === "uk";
    if (kind === "SHOP_HORSES") {
      const lines = offer.horses.map((h) => {
        const r = RARITY[h.rarity] ?? RARITY.COMMON!;
        const until = left(new Date(h.endsAt), now, lang);
        return uk
          ? `${r.icon} ${r.uk} кінь <b>${escape(h.name)}</b> — <b>${credits(h.price, lang)}</b> · ще ${until}`
          : `${r.icon} ${r.en} horse <b>${escape(h.name)}</b> — <b>${credits(h.price, lang)}</b> · ${until} left`;
      });
      const many = offer.horses.length > 1;
      const text = uk
        ? [
            `🔥 <b>${many ? "Нові коні в магазині" : "Новий кінь у магазині"} — обмежена пропозиція!</b>`,
            "",
            ...lines,
            "",
            `⏳ Після цього ${many ? "вони зникнуть" : "він зникне"} з продажу. ${many ? "Кожен кінь лише один" : "Кінь лише один"}: хто перший купить, того й кінь.`,
          ].join("\n")
        : [
            `🔥 <b>${many ? "New horses in the shop" : "A new horse in the shop"} — limited offer!</b>`,
            "",
            ...lines,
            "",
            `⏳ Then ${many ? "they leave" : "it leaves"} the shop. ${many ? "Each one is one of a kind" : "There is only one"}: first to buy gets it.`,
          ].join("\n");
      return { text, buttons: this.button(uk ? "🛒 Відкрити магазин" : "🛒 Open the shop", "/shop/") };
    }
    const blocks = offer.races.map((r) => {
      const cls = CLASS[r.class] ?? { en: r.class, uk: r.class };
      const track = trackByCode(r.track_code).name;
      return uk
        ? [
            `🏁 <b>${escape(r.name)}</b>`,
            `${cls.uk} · ${escape(track)} · ${num(r.distance, lang)} м`,
            `💰 Призовий фонд: <b>${credits(r.purse, lang)}</b>${r.entry_fee ? ` · внесок ${credits(r.entry_fee, lang)}` : " · без внеску"}`,
            `🕒 Старт через ${left(r.starts_at, now, lang)} (запис закривається за ${Math.round((r.starts_at.getTime() - r.locks_at.getTime()) / 60_000)} хв до старту)`,
          ].join("\n")
        : [
            `🏁 <b>${escape(r.name)}</b>`,
            `${cls.en} · ${escape(track)} · ${num(r.distance, lang)} m`,
            `💰 Purse: <b>${credits(r.purse, lang)}</b>${r.entry_fee ? ` · entry ${credits(r.entry_fee, lang)}` : " · free entry"}`,
            `🕒 Off in ${left(r.starts_at, now, lang)} (entries close ${Math.round((r.starts_at.getTime() - r.locks_at.getTime()) / 60_000)} min before)`,
          ].join("\n");
    });
    const many = offer.races.length > 1;
    const head = uk
      ? `📣 <b>${many ? "Нові спеціальні забіги" : "Новий спеціальний забіг"}!</b>`
      : `📣 <b>${many ? "New special races" : "A new special race"}!</b>`;
    const path = many ? "/races/" : `/race/?id=${offer.races[0]!.id}`;
    return {
      text: [head, "", blocks.join("\n\n")].join("\n"),
      buttons: this.button(uk ? "🏇 Записати коня" : "🏇 Enter a horse", path),
    };
  }

  /* ───────────────────────────── admin ───────────────────────────── */

  async list(): Promise<AnnouncementDto[]> {
    const list = await rows<AnnouncementRow & { players: number }>(
      this.db.pool,
      `SELECT a.*, (SELECT count(*)::int FROM users WHERE status = 'ACTIVE' AND telegram_id IS NOT NULL AND role <> 'SYSTEM') AS players
         FROM announcements a ORDER BY a.id DESC LIMIT 20`,
    );
    return list.map((a) => ({
      id: a.id,
      kind: a.kind,
      items: a.items.map((i) => i.name),
      status: a.cancelled_at ? "STOPPED" : a.done_at ? "SENT" : a.started_at ? "SENDING" : "WAITING",
      createdAt: a.created_at.toISOString(),
      sendAfter: a.send_after.toISOString(),
      doneAt: (a.done_at ?? a.cancelled_at)?.toISOString() ?? null,
      sent: a.sent,
      skipped: a.skipped,
      failed: a.failed,
      players: a.players,
    }));
  }

  async cancel(actorId: string, id: string): Promise<AnnouncementDto[]> {
    const r = await this.db.query(
      `UPDATE announcements SET cancelled_at = $2, cancelled_by = $3
        WHERE id = $1 AND done_at IS NULL AND cancelled_at IS NULL RETURNING id`,
      [id, this.clock.now(), actorId],
    );
    if (!r.length) throw conflict("NOT_ACTIVE", "This announcement has already gone out or was stopped");
    return this.list();
  }
}
