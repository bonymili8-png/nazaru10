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
import { BOT_API, type BotApi } from "./bot-api.js";

const COMMANDS = [
  { command: "start", description: "Open the stable" },
  { command: "paysupport", description: "Help with a purchase" },
  { command: "terms", description: "Terms of purchase" },
  { command: "help", description: "List commands" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface TelegramUpdate {
  update_id: number;
  pre_checkout_query?: PreCheckoutQuery;
  message?: {
    chat: { id: number };
    from?: { id: number; first_name?: string };
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
    if (msg && text.startsWith("/start")) {
      const param = text.split(/\s+/)[1] ?? "";
      const url = this.env.WEBAPP_URL
        ? `${this.env.WEBAPP_URL}${param ? `?startapp=${encodeURIComponent(param)}` : ""}`
        : undefined;
      await this.bot.sendMessage(
        msg.chat.id,
        "🏇 <b>Welcome to Thoroughline</b>\nBuild your stable, train champions and race for glory.",
        url ? [[{ text: "Open the stable", web_app: { url } }]] : undefined,
      );
    } else if (msg && text.startsWith("/paysupport")) {
      await this.bot.sendMessage(msg.chat.id, await this.paySupportText(msg.from?.id ?? null));
    } else if (msg && text.startsWith("/terms")) {
      await this.bot.sendMessage(msg.chat.id, this.termsText());
    } else if (msg && text.startsWith("/help")) {
      await this.bot.sendMessage(
        msg.chat.id,
        "Commands:\n/start — open the game\n/paysupport — help with a purchase\n/terms — terms of purchase\n/help — this message",
      );
    }
    return { ok: true };
  }

  /** Register the command menu so players can find /paysupport and /terms (Telegram requirement). */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.TELEGRAM_BOT_TOKEN) return;
    await this.bot.setMyCommands(COMMANDS).catch((err: unknown) => {
      this.logger.warn({ err }, "setMyCommands failed");
    });
  }

  private contactLine(): string {
    return this.env.SUPPORT_CONTACT
      ? `Contact: ${esc(this.env.SUPPORT_CONTACT)}`
      : "Reply in this chat and our team will get back to you.";
  }

  private async paySupportText(telegramId: number | null): Promise<string> {
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
        `• <code>${p.id.slice(0, 8)}</code> ${esc(productById(p.product_id)?.title ?? p.product_id)} — ${p.amount} ⭐ — ${p.status.toLowerCase()} (${p.created_at.toISOString().slice(0, 10)})`,
    );
    return [
      "💬 <b>Payment support</b>",
      recent.length
        ? `Your recent purchases:\n${lines.join("\n")}`
        : "We could not find purchases on this Telegram account.",
      "Tell us the order code and what went wrong. We answer within 48 hours; refunds are made in Telegram Stars.",
      this.contactLine(),
    ].join("\n\n");
  }

  private termsText(): string {
    const links = [
      this.env.TERMS_URL ? `<a href="${esc(this.env.TERMS_URL)}">Terms of service</a>` : null,
      this.env.PRIVACY_URL ? `<a href="${esc(this.env.PRIVACY_URL)}">Privacy policy</a>` : null,
    ].filter(Boolean);
    return [
      "📜 <b>Terms of purchase</b>",
      "• Purchases are made in Telegram Stars and buy Gems — virtual in-game items for cosmetics and convenience.",
      "• Gems and all in-game currencies have no cash value, cannot be exchanged for money or Stars and cannot be withdrawn.",
      "• Gems cannot buy credits, horses or race advantages; race results never depend on payments.",
      "• If a purchase went wrong, use /paysupport. Refunds are issued in Stars; gems already spent may make a refund impossible.",
      links.length ? links.join(" · ") : null,
      this.contactLine(),
    ]
      .filter(Boolean)
      .join("\n");
  }
}
