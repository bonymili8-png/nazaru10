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
    /** Seconds between automatic renewals (Telegram Stars subscriptions: 2592000 = 30 days). */
    subscription_period?: number;
  }): Promise<string>;
  /** Cancel (true) or re-enable (false) a user's Stars subscription by its latest charge id. */
  editUserStarSubscription(userTelegramId: number, chargeId: string, isCanceled: boolean): Promise<void>;
  answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string): Promise<void>;
  sendMessage(chatId: number, text: string, buttons?: InlineWebAppButton[][]): Promise<void>;
  refundStarPayment(userTelegramId: number, chargeId: string): Promise<void>;
  setMyCommands(commands: { command: string; description: string }[], languageCode?: string): Promise<void>;
  /** Post a photo (PNG bytes) with an HTML caption to a chat or channel (@handle); the message id. */
  sendPhoto(
    chatId: number | string,
    photo: Buffer,
    caption: string,
    buttons?: InlineWebAppButton[][],
  ): Promise<number>;
  getMe(): Promise<{ id: number; username: string }>;
  getChat(chatId: string): Promise<{ id: number; type: string; title?: string; username?: string }>;
  getChatMember(
    chatId: number | string,
    userId: number,
  ): Promise<{ status: string; can_post_messages?: boolean }>;
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

  async setMyCommands(
    commands: { command: string; description: string }[],
    languageCode?: string,
  ): Promise<void> {
    await this.call("setMyCommands", { commands, ...(languageCode ? { language_code: languageCode } : {}) });
  }

  async editUserStarSubscription(
    userTelegramId: number,
    chargeId: string,
    isCanceled: boolean,
  ): Promise<void> {
    await this.call("editUserStarSubscription", {
      user_id: userTelegramId,
      telegram_payment_charge_id: chargeId,
      is_canceled: isCanceled,
    });
  }

  async refundStarPayment(userTelegramId: number, chargeId: string): Promise<void> {
    await this.call("refundStarPayment", { user_id: userTelegramId, telegram_payment_charge_id: chargeId });
  }

  async sendPhoto(
    chatId: number | string,
    photo: Buffer,
    caption: string,
    buttons?: InlineWebAppButton[][],
  ): Promise<number> {
    if (!this.enabled) throw new Error("Telegram bot token not configured");
    // The image is uploaded (multipart), so posts never depend on a public image URL.
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("caption", caption);
    form.set("parse_mode", "HTML");
    if (buttons) form.set("reply_markup", JSON.stringify({ inline_keyboard: buttons }));
    form.set("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "card.png");
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (!json.ok) throw new Error(`Telegram sendPhoto failed: ${json.description ?? res.status}`);
    return json.result!.message_id;
  }

  getMe(): Promise<{ id: number; username: string }> {
    return this.call("getMe", {});
  }

  getChat(chatId: string): Promise<{ id: number; type: string; title?: string; username?: string }> {
    return this.call("getChat", { chat_id: chatId });
  }

  getChatMember(
    chatId: number | string,
    userId: number,
  ): Promise<{ status: string; can_post_messages?: boolean }> {
    return this.call("getChatMember", { chat_id: chatId, user_id: userId });
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
  async setMyCommands(
    commands: { command: string; description: string }[],
    languageCode?: string,
  ): Promise<void> {
    this.calls.push({ method: "setMyCommands", args: [commands, languageCode] });
  }
  async editUserStarSubscription(
    userTelegramId: number,
    chargeId: string,
    isCanceled: boolean,
  ): Promise<void> {
    this.calls.push({ method: "editUserStarSubscription", args: [userTelegramId, chargeId, isCanceled] });
  }
  async refundStarPayment(userTelegramId: number, chargeId: string): Promise<void> {
    this.calls.push({ method: "refundStarPayment", args: [userTelegramId, chargeId] });
  }
  /** Tests: make channel posts fail with this error (null: succeed). */
  photoError: string | null = null;
  /** Tests: the bot's role in channels (e.g. "member" = cannot post). */
  channelStatus = "administrator";
  private messageId = 100;
  async sendPhoto(
    chatId: number | string,
    photo: Buffer,
    caption: string,
    buttons?: InlineWebAppButton[][],
  ): Promise<number> {
    this.calls.push({ method: "sendPhoto", args: [chatId, photo, caption, buttons] });
    if (this.photoError) throw new Error(`Telegram sendPhoto failed: ${this.photoError}`);
    return ++this.messageId;
  }
  async getMe(): Promise<{ id: number; username: string }> {
    return { id: 4242, username: "thoroughline_racing_bot" };
  }
  async getChat(chatId: string): Promise<{ id: number; type: string; title?: string; username?: string }> {
    if (chatId === "@missing_channel")
      throw new Error("Telegram getChat failed: Bad Request: chat not found");
    return { id: -1001234567890, type: "channel", title: "Thoroughline Racing", username: chatId.slice(1) };
  }
  async getChatMember(): Promise<{ status: string; can_post_messages?: boolean }> {
    return { status: this.channelStatus, can_post_messages: this.channelStatus === "administrator" };
  }
}
