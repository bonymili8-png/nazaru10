import { Body, Controller, Headers, HttpCode, Inject, Post } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Public } from "../../common/auth.js";
import { unauthorized } from "../../common/errors.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { SkipRateLimit } from "../../common/rate-limit.js";
import { ENV, type Env } from "../../config/env.js";
import {
  PaymentsService,
  type PreCheckoutQuery,
  type SuccessfulPayment,
} from "../payments/payments.service.js";
import { BOT_API, type BotApi } from "./bot-api.js";

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
export class TelegramWebhookController {
  constructor(
    private readonly payments: PaymentsService,
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
      await this.bot.sendMessage(
        msg.chat.id,
        "💬 <b>Payment support</b>\nReply here with your order id (Profile → Purchases) and describe the issue. Refunds follow our refund policy; you will get an answer within 48 hours.",
      );
    } else if (msg && text.startsWith("/help")) {
      await this.bot.sendMessage(
        msg.chat.id,
        "Commands: /start — open the game, /paysupport — payment help, /help — this message.",
      );
    }
    return { ok: true };
  }
}
