import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../../common/db.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { credits, type Lang, langOf, num, ordinal } from "../../common/i18n.js";
import { BOT_API, type BotApi } from "../telegram/bot-api.js";

interface EventRow {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

const escape = (s: unknown) =>
  String(s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

const INJURY_UK: Record<string, string> = { MINOR: "легку", MODERATE: "помірну" };
const injuryUk = (s: unknown) => INJURY_UK[String(s)] ?? String(s).toLowerCase();
const place = (n: number) => `${n}-є місце`;

/** Turns outbox events into Telegram messages (best effort, respecting user preferences and language). */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: Db,
    @Inject(BOT_API) private readonly bot: BotApi,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  render(e: EventRow, lang: Lang = "en"): { userId: string; text: string } | null {
    const p = e.payload;
    const uk = lang === "uk";
    const userId = String(p.userId);
    const name = (k: string) => `<b>${escape(p[k])}</b>`;
    switch (e.type) {
      case "race_result": {
        const pos = Number(p.position);
        const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "🏁";
        const earned = Number(p.prize) > 0;
        const text = uk
          ? `${medal} ${name("horseName")}: ${place(pos)} з ${Number(p.field)} у забігу «${escape(p.raceName)}»` +
            (earned ? `, виграш ${credits(p.prize, lang)}` : "") +
            "." +
            (p.injury ? `\n⚠️ Отримано ${injuryUk(p.injury)} травму — зверніться до ветеринара.` : "")
          : `${medal} ${name("horseName")} finished ${ordinal(pos, lang)} of ${Number(p.field)} in ${escape(p.raceName)}` +
            (earned ? ` and earned ${credits(p.prize, lang)}` : "") +
            "." +
            (p.injury ? `\n⚠️ Picked up a ${String(p.injury).toLowerCase()} injury — check the vet.` : "");
        return { userId, text };
      }
      case "training_completed":
        return {
          userId,
          text: uk
            ? p.injury
              ? `🩺 ${name("horseName")} завершив тренування, але отримав ${injuryUk(p.injury)} травму.`
              : `💪 ${name("horseName")} завершив тренування й повернувся до стайні.`
            : p.injury
              ? `🩺 ${name("horseName")} finished training but picked up a ${String(p.injury).toLowerCase()} injury.`
              : `💪 ${name("horseName")} finished training and is back in the barn.`,
        };
      case "market_sale_completed":
        return {
          userId,
          text: uk
            ? `🤝 ${name("horseName")} продано за ${credits(p.price, lang)} (комісія ${num(p.fee, lang)}).`
            : `🤝 ${name("horseName")} sold for ${credits(p.price, lang)} (fee ${num(p.fee, lang)}).`,
        };
      case "season_reward":
        return {
          userId,
          text: uk
            ? `🏆 Сезон ${Number(p.season)} завершено — ви на <b>${Number(p.rank)}-му</b> місці з ${Number(p.points)} очками й отримали ${credits(p.credits, lang)} та бонуси.`
            : `🏆 Season ${Number(p.season)} is over — you finished <b>${ordinal(Number(p.rank), lang)}</b> with ${Number(p.points)} points and earned ${credits(p.credits, lang)} plus bonuses.`,
        };
      case "foal_delivered":
        return {
          userId,
          text: uk
            ? `🐴 Народилося ${p.mutation ? "непересічне " : ""}лоша: ${name("foalName")} (${escape(p.sireName)} × ${escape(p.damName)}).`
            : `🐴 A ${p.mutation ? "remarkable " : ""}foal has arrived: ${name("foalName")} (${escape(p.sireName)} × ${escape(p.damName)}).`,
        };
      case "market_outbid":
        return {
          userId,
          text: uk
            ? `🔔 Вашу ставку на ${name("horseName")} перебито (${credits(p.amount, lang)}). Депозит повернено.`
            : `🔔 You were outbid on ${name("horseName")} (${credits(p.amount, lang)}). Your escrow has been returned.`,
        };
      case "tournament_champion":
        return {
          userId,
          text: uk
            ? `🏆 ${name("horseName")} виграв «${escape(p.tournamentName)}»! Нагороди чемпіона вже у вашому гаманці.`
            : `🏆 ${name("horseName")} won the ${escape(p.tournamentName)}! Champion honours are in your wallet.`,
        };
      case "trainer_left":
        return {
          userId,
          text: uk
            ? `📋 ${name("trainerName")} залишив вашу стайню — не вдалося сплатити тижневу зарплату ${credits(p.salary, lang)}.`
            : `📋 ${name("trainerName")} has left your stable — the weekly salary of ${credits(p.salary, lang)} could not be paid.`,
        };
      case "payment_completed":
        return {
          userId,
          text: uk
            ? "💎 Покупку завершено — дякуємо! Самоцвіти вже у вашому гаманці."
            : "💎 Purchase complete — thank you! Your gems are in your wallet.",
        };
      default:
        return null;
    }
  }

  async processOutbox(limit = 100): Promise<number> {
    const messages = await this.db.tx(async (c) => {
      const events = await c.query<EventRow>(
        "SELECT id, type, payload FROM domain_events WHERE processed_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED",
        [limit],
      );
      if (events.rows.length === 0) return [];
      await c.query("UPDATE domain_events SET processed_at = now() WHERE id = ANY($1::bigint[])", [
        events.rows.map((e) => e.id),
      ]);
      const out: { chatId: number; text: string }[] = [];
      for (const e of events.rows) {
        const userId = this.render(e)?.userId;
        if (!userId) continue;
        const u = await c.query<{
          telegram_id: number | null;
          language_code: string | null;
          settings: { notifications?: boolean; locale?: string };
        }>("SELECT telegram_id, language_code, settings FROM users WHERE id = $1 AND status = 'ACTIVE'", [
          userId,
        ]);
        const user = u.rows[0];
        if (!user?.telegram_id || user.settings.notifications === false) continue;
        const m = this.render(e, langOf(user.language_code, user.settings.locale));
        if (!m) continue;
        out.push({ chatId: user.telegram_id, text: m.text });
      }
      return out;
    });
    for (const m of messages) {
      try {
        await this.bot.sendMessage(m.chatId, m.text);
      } catch (err) {
        this.logger.warn({ err, chatId: m.chatId }, "notification delivery failed");
      }
    }
    return messages.length;
  }
}
