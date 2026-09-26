import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  type OnApplicationBootstrap,
  Post,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Public } from "../../common/auth.js";
import { Db } from "../../common/db.js";
import { unauthorized } from "../../common/errors.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { SkipRateLimit } from "../../common/rate-limit.js";
import { ENV, type Env } from "../../config/env.js";
import {
  PaymentsService,
  type PreCheckoutQuery,
  type SuccessfulPayment,
} from "../payments/payments.service.js";
import { productById } from "../payments/catalog.js";
import { type Lang, langOf } from "../../common/i18n.js";
import { BOT_API, type BotApi } from "./bot-api.js";

const COMMANDS: Record<Lang, { command: string; description: string }[]> = {
  en: [
    { command: "start", description: "Open the stable" },
    { command: "paysupport", description: "Help with a purchase" },
    { command: "terms", description: "Terms of purchase" },
    { command: "help", description: "List commands" },
  ],
  uk: [
    { command: "start", description: "Відкрити стайню" },
    { command: "paysupport", description: "Допомога з покупкою" },
    { command: "terms", description: "Умови покупок" },
    { command: "help", description: "Список команд" },
  ],
};

const TEXT = {
  en: {
    welcome: "🏇 <b>Welcome to Thoroughline</b>\nBuild your stable, train champions and race for glory.",
    open: "Open the stable",
    help: "Commands:\n/start — open the game\n/paysupport — help with a purchase\n/terms — terms of purchase\n/help — this message",
    contact: "Contact:",
    replyHere: "Reply in this chat and our team will get back to you.",
    support: "💬 <b>Payment support</b>",
    recent: "Your recent purchases:",
    none: "We could not find purchases on this Telegram account.",
    howTo:
      "Tell us the order code and what went wrong. We answer within 48 hours; refunds are made in Telegram Stars.",
    status: { completed: "completed", refunded: "refunded", failed: "failed" } as Record<string, string>,
    terms: "📜 <b>Terms of purchase</b>",
    tos: "Terms of service",
    privacy: "Privacy policy",
    rules: [
      "• Purchases are made in Telegram Stars and buy Gems — virtual in-game items for cosmetics and convenience.",
      "• Gems and all in-game currencies have no cash value, cannot be exchanged for money or Stars and cannot be withdrawn.",
      "• Gems cannot buy credits, horses or race advantages; race results never depend on payments.",
      "• If a purchase went wrong, use /paysupport. Refunds are issued in Stars; gems already spent may make a refund impossible.",
    ],
  },
  uk: {
    welcome: "🏇 <b>Вітаємо в Thoroughline</b>\nЗбудуйте стайню, виховайте чемпіонів і змагайтеся за славу.",
    open: "Відкрити стайню",
    help: "Команди:\n/start — відкрити гру\n/paysupport — допомога з покупкою\n/terms — умови покупок\n/help — це повідомлення",
    contact: "Контакт:",
    replyHere: "Напишіть у цей чат, і наша команда відповість вам.",
    support: "💬 <b>Підтримка платежів</b>",
    recent: "Ваші останні покупки:",
    none: "Ми не знайшли покупок на цьому акаунті Telegram.",
    howTo:
      "Надішліть код замовлення й опишіть проблему. Відповідаємо протягом 48 годин; повернення здійснюються в Telegram Stars.",
    status: { completed: "завершено", refunded: "повернено", failed: "не вдалося" } as Record<string, string>,
    terms: "📜 <b>Умови покупок</b>",
    tos: "Умови використання",
    privacy: "Політика конфіденційності",
    rules: [
      "• Покупки здійснюються в Telegram Stars; за них ви отримуєте самоцвіти — віртуальні ігрові предмети для косметики й зручності.",
      "• Самоцвіти та всі ігрові валюти не мають грошової вартості, їх не можна обміняти на гроші чи Stars і не можна вивести.",
      "• За самоцвіти не можна купити кредити, коней чи переваги в забігах; результати забігів ніколи не залежать від платежів.",
      "• Якщо з покупкою щось не так, скористайтеся /paysupport. Повернення здійснюються в Stars; якщо самоцвіти вже витрачено, повернення може бути неможливим.",
    ],
  },
} satisfies Record<Lang, unknown>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface TelegramUpdate {
  update_id: number;
  pre_checkout_query?: PreCheckoutQuery;
  message?: {
    chat: { id: number };
    from?: { id: number; first_name?: string; language_code?: string };
    text?: string;
    successful_payment?: SuccessfulPayment;
  };
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Bot webhook: authenticated by Telegram's secret-token header (set via setWebhook). */
@Controller("telegram")
@Public()
@SkipRateLimit()
export class TelegramWebhookController implements OnApplicationBootstrap {
  constructor(
    private readonly payments: PaymentsService,
    private readonly db: Db,
    @Inject(BOT_API) private readonly bot: BotApi,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() update: TelegramUpdate,
  ) {
    if (!this.env.TELEGRAM_WEBHOOK_SECRET || !secret || !safeEqual(secret, this.env.TELEGRAM_WEBHOOK_SECRET))
      throw unauthorized();

    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const answer = await this.payments.preCheckout(q).catch((err: unknown) => {
        this.logger.error({ err }, "pre-checkout validation failed");
        return { ok: false, error: "Temporary error, please retry" };
      });
      await this.bot.answerPreCheckoutQuery(q.id, answer.ok, answer.error);
      return { ok: true };
    }

    const msg = update.message;
    if (msg?.successful_payment && msg.from) {
      const outcome = await this.payments.complete(msg.from.id, msg.successful_payment);
      this.logger.info(
        { outcome, payload: msg.successful_payment.invoice_payload },
        "successful_payment processed",
      );
      return { ok: true };
    }

    const text = msg?.text?.trim() ?? "";
    if (!msg || !text.startsWith("/")) return { ok: true };
    const lang = await this.langFor(msg.from);
    const T = TEXT[lang];
    if (text.startsWith("/start")) {
      const param = text.split(/\s+/)[1] ?? "";
      const url = this.env.WEBAPP_URL
        ? `${this.env.WEBAPP_URL}${param ? `?startapp=${encodeURIComponent(param)}` : ""}`
        : undefined;
      await this.bot.sendMessage(
        msg.chat.id,
        T.welcome,
        url ? [[{ text: T.open, web_app: { url } }]] : undefined,
      );
    } else if (text.startsWith("/paysupport")) {
      await this.bot.sendMessage(msg.chat.id, await this.paySupportText(msg.from?.id ?? null, lang));
    } else if (text.startsWith("/terms")) {
      await this.bot.sendMessage(msg.chat.id, this.termsText(lang));
    } else if (text.startsWith("/help")) {
      await this.bot.sendMessage(msg.chat.id, T.help);
    }
    return { ok: true };
  }

  /** Register the command menu so players can find /paysupport and /terms (Telegram requirement). */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.TELEGRAM_BOT_TOKEN) return;
    for (const [lang, commands] of Object.entries(COMMANDS)) {
      await this.bot.setMyCommands(commands, lang === "en" ? undefined : lang).catch((err: unknown) => {
        this.logger.warn({ err, lang }, "setMyCommands failed");
      });
    }
  }

  /** The player's chosen language if they have an account, else their Telegram client language. */
  private async langFor(from: { id: number; language_code?: string } | undefined): Promise<Lang> {
    if (!from) return "en";
    const u = await this.db
      .one<{ settings: { locale?: string } }>("SELECT settings FROM users WHERE telegram_id = $1", [from.id])
      .catch(() => null);
    return langOf(from.language_code, u?.settings.locale);
  }

  private contactLine(lang: Lang): string {
    return this.env.SUPPORT_CONTACT
      ? `${TEXT[lang].contact} ${esc(this.env.SUPPORT_CONTACT)}`
      : TEXT[lang].replyHere;
  }

  private async paySupportText(telegramId: number | null, lang: Lang): Promise<string> {
    const T = TEXT[lang];
    const recent = telegramId
      ? await this.db.query<{
          id: string;
          product_id: string;
          amount: number;
          status: string;
          created_at: Date;
        }>(
          `SELECT p.id, p.product_id, p.amount, p.status, p.created_at FROM payments p JOIN users u ON u.id = p.user_id
            WHERE u.telegram_id = $1 AND p.status IN ('COMPLETED','REFUNDED','FAILED')
            ORDER BY p.created_at DESC LIMIT 3`,
          [telegramId],
        )
      : [];
    const lines = recent.map(
      (p) =>
        `• <code>${p.id.slice(0, 8)}</code> ${esc(productById(p.product_id)?.title ?? p.product_id)} — ${p.amount} ⭐ — ${T.status[p.status.toLowerCase()] ?? p.status.toLowerCase()} (${p.created_at.toISOString().slice(0, 10)})`,
    );
    return [
      T.support,
      recent.length ? `${T.recent}\n${lines.join("\n")}` : T.none,
      T.howTo,
      this.contactLine(lang),
    ].join("\n\n");
  }

  private termsText(lang: Lang): string {
    const T = TEXT[lang];
    const links = [
      this.env.TERMS_URL ? `<a href="${esc(this.env.TERMS_URL)}">${T.tos}</a>` : null,
      this.env.PRIVACY_URL ? `<a href="${esc(this.env.PRIVACY_URL)}">${T.privacy}</a>` : null,
    ].filter(Boolean);
    return [T.terms, ...T.rules, links.length ? links.join(" · ") : null, this.contactLine(lang)]
      .filter(Boolean)
      .join("\n");
  }
}
