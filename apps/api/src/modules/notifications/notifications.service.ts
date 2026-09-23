import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../../common/db.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { BOT_API, type BotApi } from "../telegram/bot-api.js";

interface EventRow {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

const escape = (s: unknown) =>
  String(s).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Turns outbox events into Telegram messages (best effort, respecting user preferences). */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: Db,
    @Inject(BOT_API) private readonly bot: BotApi,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  render(e: EventRow): { userId: string; text: string } | null {
    const p = e.payload;
    switch (e.type) {
      case "race_result": {
        const pos = Number(p.position);
        const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "🏁";
        const prize =
          Number(p.prize) > 0 ? ` and earned ${Number(p.prize).toLocaleString("en")} credits` : "";
        const injury = p.injury
          ? `\n⚠️ Picked up a ${String(p.injury).toLowerCase()} injury — check the vet.`
          : "";
        return {
          userId: String(p.userId),
          text: `${medal} <b>${escape(p.horseName)}</b> finished ${ordinal(pos)} of ${Number(p.field)} in ${escape(p.raceName)}${prize}.${injury}`,
        };
      }
      case "training_completed":
        return {
          userId: String(p.userId),
          text: p.injury
            ? `🩺 <b>${escape(p.horseName)}</b> finished training but picked up a ${String(p.injury).toLowerCase()} injury.`
            : `💪 <b>${escape(p.horseName)}</b> finished training and is back in the barn.`,
        };
      case "market_sale_completed":
        return {
          userId: String(p.userId),
          text: `🤝 <b>${escape(p.horseName)}</b> sold for ${Number(p.price).toLocaleString("en")} credits (fee ${Number(p.fee).toLocaleString("en")}).`,
        };
      case "season_reward":
        return {
          userId: String(p.userId),
          text: `🏆 Season ${Number(p.season)} is over — you finished <b>${ordinal(Number(p.rank))}</b> with ${Number(p.points)} points and earned ${Number(p.credits).toLocaleString("en")} credits plus bonuses.`,
        };
      case "foal_delivered":
        return {
          userId: String(p.userId),
          text: `🐴 A ${p.mutation ? "remarkable " : ""}foal has arrived: <b>${escape(p.foalName)}</b> (${escape(p.sireName)} × ${escape(p.damName)}).`,
        };
      case "market_outbid":
        return {
          userId: String(p.userId),
          text: `🔔 You were outbid on <b>${escape(p.horseName)}</b> (${Number(p.amount).toLocaleString("en")} credits). Your escrow has been returned.`,
        };
      case "tournament_champion":
        return {
          userId: String(p.userId),
          text: `🏆 <b>${escape(p.horseName)}</b> won the ${escape(p.tournamentName)}! Champion honours are in your wallet.`,
        };
      case "trainer_left":
        return {
          userId: String(p.userId),
          text: `📋 <b>${escape(p.trainerName)}</b> has left your stable — the weekly salary of ${Number(p.salary).toLocaleString("en")} credits could not be paid.`,
        };
      case "payment_completed":
        return {
          userId: String(p.userId),
          text: "💎 Purchase complete — thank you! Your gems are in your wallet.",
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
        const m = this.render(e);
        if (!m) continue;
        const u = await c.query<{ telegram_id: number | null; settings: { notifications?: boolean } }>(
          "SELECT telegram_id, settings FROM users WHERE id = $1 AND status = 'ACTIVE'",
          [m.userId],
        );
        const user = u.rows[0];
        if (!user?.telegram_id || user.settings.notifications === false) continue;
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
