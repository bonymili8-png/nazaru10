import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../../common/db.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { ENV, type Env } from "../../config/env.js";
import { credits, type Lang, langOf, num, ordinal, ukPlural } from "../../common/i18n.js";
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
    @Inject(ENV) private readonly env: Env,
  ) {}

  render(
    e: EventRow,
    lang: Lang = "en",
  ): { userId: string; text: string; openApp?: boolean; path?: string } | null {
    const p = e.payload;
    const uk = lang === "uk";
    const userId = String(p.userId);
    const name = (k: string) => `<b>${escape(p[k])}</b>`;
    switch (e.type) {
      case "race_result": {
        const pos = Number(p.position);
        const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "🏁";
        const earned = Number(p.prize) > 0;
        const bonus = Number(p.dailyBonus ?? 0);
        const text = uk
          ? `${medal} ${name("horseName")}: ${place(pos)} з ${Number(p.field)} у забігу «${escape(p.raceName)}»` +
            (earned ? `, виграш ${credits(p.prize, lang)}` : "") +
            "." +
            (bonus > 0 ? `\n🎁 Бонус за першу гонку дня: +${credits(bonus, lang)}.` : "") +
            (p.injury ? `\n⚠️ Отримано ${injuryUk(p.injury)} травму — зверніться до ветеринара.` : "")
          : `${medal} ${name("horseName")} finished ${ordinal(pos, lang)} of ${Number(p.field)} in ${escape(p.raceName)}` +
            (earned ? ` and earned ${credits(p.prize, lang)}` : "") +
            "." +
            (bonus > 0 ? `\n🎁 First race of the day bonus: +${credits(bonus, lang)}.` : "") +
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
      // Folded into "tournament_result", which tells every owner how the tournament went.
      case "tournament_champion":
        return null;
      case "tournament_draw":
      case "tournament_heats_result":
      case "tournament_result":
      case "tournament_called_off": {
        const text = tournamentText(e.type, p, lang, Date.now());
        return { userId, text, openApp: true, path: `/tournament/?id=${String(p.tournamentId)}` };
      }
      case "trainer_left":
        return {
          userId,
          text: uk
            ? `📋 ${name("trainerName")} залишив вашу стайню — не вдалося сплатити тижневу зарплату ${credits(p.salary, lang)}.`
            : `📋 ${name("trainerName")} has left your stable — the weekly salary of ${credits(p.salary, lang)} could not be paid.`,
        };
      case "offer_received":
        return {
          userId,
          openApp: true,
          text: uk
            ? `💰 Пропозиція за ${name("horseName")}: ${credits(p.amount, lang)}. Прийняти чи відхилити можна на ринку протягом 48 годин.`
            : `💰 An offer for ${name("horseName")}: ${credits(p.amount, lang)}. Accept or decline it in the market within 48 hours.`,
        };
      case "offer_accepted":
        return {
          userId,
          openApp: true,
          text: uk
            ? `🎉 Вашу пропозицію прийнято: ${name("horseName")} тепер у вашій стайні!`
            : `🎉 Your offer was accepted: ${name("horseName")} is now in your stable!`,
        };
      case "offer_declined":
        return {
          userId,
          text: uk
            ? `Власник ${name("horseName")} відхилив вашу пропозицію; ${credits(p.amount, lang)} повернуто.`
            : `The owner of ${name("horseName")} declined your offer; ${credits(p.amount, lang)} returned.`,
        };
      case "followed_win":
        return {
          userId,
          openApp: true,
          text: uk
            ? `⭐ ${name("horseName")}, за яким ви стежите, виграв забіг «${escape(p.raceName)}»!`
            : `⭐ ${name("horseName")}, a horse you follow, won the ${escape(p.raceName)}!`,
        };
      case "gear_worn": {
        const item = String(p.item);
        const names: Record<string, [string, string]> = {
          BLINKERS: ["blinkers", "шори"],
          SHADOW_ROLL: ["shadow roll", "шедоу-рол"],
          TONGUE_TIE: ["tongue tie", "язикова пов'язка"],
          RACING_PLATES: ["racing plates", "легкі підкови"],
          CROSS_NOSEBAND: ["cross noseband", "хрестовий капсуль"],
        };
        const [en, ukName] = names[item] ?? [item.toLowerCase(), item.toLowerCase()];
        return {
          userId,
          text: uk
            ? `🔧 Спорядження зносилось: ${ukName}. Купіть нове в амуніції (краще лагодити завчасно — це дешевше).`
            : `🔧 Your ${en} wore out. Buy a new set in the tack room (repairing earlier is cheaper).`,
        };
      }
      case "comeback_nudge":
        return {
          userId,
          openApp: true,
          text: uk
            ? `🐎 ${name("horseName")} відпочив і готовий до старту. Забіги стартують щокілька хвилин — стайня чекає на вас!`
            : `🐎 ${name("horseName")} is rested and ready to run. Races go off every few minutes — your stable is waiting!`,
        };
      case "feed_lapsed": {
        const plan = uk
          ? p.plan === "ELITE"
            ? "елітний"
            : "преміум"
          : p.plan === "ELITE"
            ? "elite"
            : "premium";
        return {
          userId,
          text: uk
            ? `🥕 ${name("horseName")}: ${plan} корм закінчився — не вистачило кредитів на наступний тиждень. Кінь знову на стандартному кормі.`
            : `🥕 ${name("horseName")}: the ${plan} feed plan has ended — not enough credits for the next week. Back on standard feed.`,
        };
      }
      case "sponsor_completed":
        return {
          userId,
          text: uk
            ? `🤝 Контракт зі спонсором «${escape(p.sponsor)}» виконано! На гаманець зараховано ${credits(p.reward, lang)}.`
            : `🤝 Sponsor contract with ${escape(p.sponsor)} complete! ${credits(p.reward, lang)} added to your wallet.`,
        };
      case "subscription_renewed":
        return {
          userId,
          text: uk
            ? `👑 Членство в «Колі власників» продовжено — ${Number(p.gems)} самоцвітів уже на гаманці.`
            : `👑 Your Owners' Circle membership renewed — ${Number(p.gems)} gems are in your wallet.`,
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
      const out: { chatId: number; text: string; button?: string; path?: string }[] = [];
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
        const lang = langOf(user.language_code, user.settings.locale);
        out.push({
          chatId: user.telegram_id,
          text: m.text,
          button: !m.openApp
            ? undefined
            : m.path
              ? lang === "uk"
                ? "Відкрити турнір"
                : "Open the tournament"
              : lang === "uk"
                ? "Відкрити стайню"
                : "Open the stable",
          path: m.path,
        });
      }
      return out;
    });
    for (const m of messages) {
      try {
        // A deep link opens the Mini App straight on the page the message is about.
        const base = this.env.WEBAPP_URL;
        const url = base && m.path ? `${base.replace(/\/$/, "")}${m.path}` : base;
        await this.bot.sendMessage(
          m.chatId,
          m.text,
          m.button && url ? [[{ text: m.button, web_app: { url } }]] : undefined,
        );
      } catch (err) {
        this.logger.warn({ err, chatId: m.chatId }, "notification delivery failed");
      }
    }
    return messages.length;
  }
}

const TOURNAMENT_REASON_UK: Record<string, string> = {
  "Not enough entrants": "замало учасників",
  "Final cancelled": "фінал скасовано",
  "No eligible finalists": "жоден фіналіст не зміг бігти",
  "Heat cancelled": "забіг скасовано",
};

/**
 * Tournament messages, one per owner and step: the draw, the heats, the final result, or a
 * call-off with the refund. Each lists the owner's horses.
 */
export function tournamentText(type: string, p: Record<string, unknown>, lang: Lang, now: number): string {
  const uk = lang === "uk";
  const b = (v: unknown) => `<b>${escape(v)}</b>`;
  const cup = b(p.tournamentName);
  const horses = (p.horses ?? []) as Record<string, unknown>[];
  const mins = (iso: unknown) => Math.max(1, Math.round((new Date(String(iso)).getTime() - now) / 60_000));
  const off = (iso: unknown) => (uk ? `старт приблизно за ${mins(iso)} хв` : `off in about ${mins(iso)} min`);
  const pos = (n: unknown) => (uk ? place(Number(n)) : ordinal(Number(n), lang));
  switch (type) {
    case "tournament_draw": {
      const heats = Number(p.heats);
      const head =
        heats === 0
          ? uk
            ? `🏁 ${cup}: лише ${Number(p.entrants)} ${ukPlural(Number(p.entrants), "учасник", "учасники", "учасників")}, тож одразу фінал.`
            : `🏁 ${cup}: only ${Number(p.entrants)} runners, so it goes straight to the final.`
          : uk
            ? `🏁 ${cup}: жеребкування — ${Number(p.entrants)} ${ukPlural(Number(p.entrants), "кінь", "коні", "коней")} у ${heats} забігах; до фіналу виходять ${Number(p.qualifiersPerHeat)} найкращі з кожного.`
            : `🏁 ${cup}: the draw is out — ${Number(p.entrants)} horses in ${heats} heats; the top ${Number(p.qualifiersPerHeat)} of each go to the final.`;
      const lines = horses.map((h) =>
        Number(h.heat) === 0
          ? `• ${b(h.horseName)} — ${uk ? "фінал" : "the final"}, ${off(h.startsAt)}`
          : `• ${b(h.horseName)} — ${uk ? `забіг ${Number(h.heat)}` : `Heat ${Number(h.heat)}`}, ${off(h.startsAt)}`,
      );
      return [head, ...lines].join("\n");
    }
    case "tournament_heats_result": {
      const lines = horses.map((h) => {
        const heat = uk ? `у забігу ${Number(h.heat)}` : `in Heat ${Number(h.heat)}`;
        switch (h.result) {
          case "QUALIFIED":
            return uk
              ? `✅ ${b(h.horseName)} — ${pos(h.position)} ${heat}, вийшов у фінал`
              : `✅ ${b(h.horseName)} — ${pos(h.position)} ${heat}, through to the final`;
          case "SCRATCHED":
            return uk
              ? `⚠️ ${b(h.horseName)} — ${pos(h.position)} ${heat}, але не готовий бігти фінал`
              : `⚠️ ${b(h.horseName)} — ${pos(h.position)} ${heat}, but not fit to run the final`;
          case "REFUNDED":
            return uk
              ? `↩️ ${b(h.horseName)} — забіг ${Number(h.heat)} скасовано, внесок повернено`
              : `↩️ ${b(h.horseName)} — Heat ${Number(h.heat)} was cancelled, entry fee refunded`;
          default:
            return uk
              ? `❌ ${b(h.horseName)} — ${h.position ? `${pos(h.position)} ${heat}` : `не фінішував ${heat}`}, вибув`
              : `❌ ${b(h.horseName)} — ${h.position ? `${pos(h.position)} ${heat}` : `did not finish ${heat}`}, out`;
        }
      });
      const tailLine = p.finalAt
        ? uk
          ? `Фінал: ${off(p.finalAt)}.`
          : `The final is ${off(p.finalAt)}.`
        : uk
          ? "Жоден фіналіст не зміг бігти — турнір скасовано."
          : "No finalist could run, so the tournament is called off.";
      return [uk ? `🏇 ${cup}: забіги завершено.` : `🏇 ${cup}: the heats are run.`, ...lines, tailLine].join(
        "\n",
      );
    }
    case "tournament_result": {
      const mineChamp = horses.find((h) => h.champion);
      const honours = [
        Number(p.championReputation) > 0
          ? `+${Number(p.championReputation)} ${uk ? "репутації" : "reputation"}`
          : null,
        Number(p.championPrestige) > 0
          ? `+${Number(p.championPrestige)} ${uk ? "престижу" : "prestige"}`
          : null,
      ].filter(Boolean);
      const champLine = p.championHorse
        ? uk
          ? `Чемпіон: ${b(p.championHorse)}${p.championOwner ? ` (${escape(p.championOwner)})` : ""}.`
          : `Champion: ${b(p.championHorse)}${p.championOwner ? ` (${escape(p.championOwner)})` : ""}.`
        : "";
      const head = mineChamp
        ? uk
          ? `🏆 ${b(mineChamp.horseName)} виграв ${cup}!`
          : `🏆 ${b(mineChamp.horseName)} won the ${cup}!`
        : uk
          ? `🏁 ${cup} завершено. ${champLine}`
          : `🏁 The ${cup} is over. ${champLine}`;
      const lines = horses.map((h) => {
        const prize = Number(h.prize) > 0 ? `, +${credits(h.prize, lang)}` : "";
        if (h.champion)
          return `🥇 ${b(h.horseName)} — ${uk ? "чемпіон" : "champion"}${prize}${honours.length ? `, ${honours.join(", ")}` : ""}`;
        if (h.finalRank) {
          const medal = Number(h.finalRank) === 2 ? "🥈" : Number(h.finalRank) === 3 ? "🥉" : "•";
          return uk
            ? `${medal} ${b(h.horseName)} — ${pos(h.finalRank)} з ${Number(p.finalists)} у фіналі${prize}`
            : `${medal} ${b(h.horseName)} — ${pos(h.finalRank)} of ${Number(p.finalists)} in the final${prize}`;
        }
        if (h.status === "ELIMINATED")
          return uk
            ? `• ${b(h.horseName)} — вибув у відбіркових забігах${h.heatPosition ? ` (${pos(h.heatPosition)})` : ""}`
            : `• ${b(h.horseName)} — out in the heats${h.heatPosition ? ` (${pos(h.heatPosition)})` : ""}`;
        return uk ? `• ${b(h.horseName)} — не стартував` : `• ${b(h.horseName)} — did not run`;
      });
      return [
        head,
        ...lines,
        uk ? "Повна таблиця — на сторінці турніру." : "Full table on the tournament page.",
      ].join("\n");
    }
    case "tournament_called_off": {
      const why = uk
        ? (TOURNAMENT_REASON_UK[String(p.reason)] ?? String(p.reason))
        : String(p.reason).toLowerCase();
      const names = horses.map((h) => b(h)).join(", ");
      return uk
        ? `↩️ ${cup} скасовано (${escape(why)}). Внесок повернено: ${credits(p.refund, lang)} за ${names}.`
        : `↩️ The ${cup} was called off (${escape(why)}). Entry fee refunded: ${credits(p.refund, lang)} for ${names}.`;
    }
    default:
      return "";
  }
}
