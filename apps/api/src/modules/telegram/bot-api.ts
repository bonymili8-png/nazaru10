import type { Logger } from "../../common/logger.js";

export interface InlineWebAppButton {
  text: string;
  web_app?: { url: string };
  url?: string;
}

/** Subset of the Telegram Bot API we use. Implemented over HTTPS, faked in tests. */
export interface BotApi {
  readonly enabled: boolean;
  createInvoiceLink(p: {
    title: string;
    description: string;
    payload: string;
    currency: "XTR";
    prices: { label: string; amount: number }[];
  }): Promise<string>;
  answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void>;
  sendMessage(chatId: number, text: string, buttons?: InlineWebAppButton[][]): Promise<void>;
  refundStarPayment(userTelegramId: number, chargeId: string): Promise<void>;
  setMyCommands(commands: { command: string; description: string }[]): Promise<void>;
}

export const BOT_API = Symbol("BOT_API");

export class HttpBotApi implements BotApi {
  readonly enabled: boolean;
  constructor(
    private readonly token: string,
    private readonly logger: Logger,
  ) {
    this.enabled = token.length > 0;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    if (!this.enabled) throw new Error("Telegram bot token not configured");
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
    return json.result as T;
  }

  createInvoiceLink(p: Parameters<BotApi["createInvoiceLink"]>[0]): Promise<string> {
    // Digital goods inside Telegram are paid with Telegram Stars (currency XTR, empty provider token).
    return this.call<string>("createInvoiceLink", { ...p, provider_token: "" });
  }

  async answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void> {
    await this.call("answerPreCheckoutQuery", {
      pre_checkout_query_id: id,
      ok,
      ...(ok ? {} : { error_message: errorMessage }),
    });
  }

  async sendMessage(chatId: number, text: string, buttons?: InlineWebAppButton[][]): Promise<void> {
    if (!this.enabled) {
      this.logger.debug({ chatId, text }, "telegram disabled: message not sent");
      return;
    }
    await this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    await this.call("setMyCommands", { commands });
  }

  async refundStarPayment(userTelegramId: number, chargeId: string): Promise<void> {
    await this.call("refundStarPayment", { user_id: userTelegramId, telegram_payment_charge_id: chargeId });
  }
}

/** Records calls instead of talking to Telegram (tests, local dev). */
export class FakeBotApi implements BotApi {
  readonly enabled = true;
  readonly calls: { method: string; args: unknown[] }[] = [];
  async createInvoiceLink(p: Parameters<BotApi["createInvoiceLink"]>[0]): Promise<string> {
    this.calls.push({ method: "createInvoiceLink", args: [p] });
    return `https://t.me/$fake_invoice_${p.payload}`;
  }
  async answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void> {
    this.calls.push({ method: "answerPreCheckoutQuery", args: [id, ok, errorMessage] });
  }
  async sendMessage(chatId: number, text: string, buttons?: InlineWebAppButton[][]): Promise<void> {
    this.calls.push({ method: "sendMessage", args: [chatId, text, buttons] });
  }
  async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    this.calls.push({ method: "setMyCommands", args: [commands] });
  }
  async refundStarPayment(userTelegramId: number, chargeId: string): Promise<void> {
    this.calls.push({ method: "refundStarPayment", args: [userTelegramId, chargeId] });
  }
}
