import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "../../common/errors.js";
import { BOT_API, type BotApi } from "../telegram/bot-api.js";
import type { Product } from "./catalog.js";

export type ProviderName = "TELEGRAM_STARS" | "STRIPE";

/** Payment providers are interchangeable behind this interface; business logic never talks to them directly. */
export interface PaymentProvider {
  readonly name: ProviderName;
  readonly currency: string;
  price(product: Product): number;
  createCheckout(paymentId: string, product: Product): Promise<{ invoiceLink: string }>;
  refund(p: { userTelegramId: number; chargeId: string }): Promise<void>;
}

/** Telegram Stars (XTR) — required for digital goods sold inside Telegram. */
@Injectable()
export class TelegramStarsProvider implements PaymentProvider {
  readonly name = "TELEGRAM_STARS" as const;
  readonly currency = "XTR";
  constructor(@Inject(BOT_API) private readonly bot: BotApi) {}

  price(product: Product): number {
    return product.priceStars;
  }

  async createCheckout(paymentId: string, product: Product) {
    const invoiceLink = await this.bot.createInvoiceLink({
      title: product.title,
      description: product.description,
      payload: paymentId,
      currency: "XTR",
      prices: [{ label: product.title, amount: product.priceStars }],
    });
    return { invoiceLink };
  }

  refund(p: { userTelegramId: number; chargeId: string }): Promise<void> {
    return this.bot.refundStarPayment(p.userTelegramId, p.chargeId);
  }
}

/**
 * Stripe is reserved for flows Telegram allows outside Stars (external web checkout, B2B,
 * physical / real-world services). Disabled until such a product exists.
 */
@Injectable()
export class StripeProvider implements PaymentProvider {
  readonly name = "STRIPE" as const;
  readonly currency = "USD";
  price(): number {
    throw new AppError(501, "PROVIDER_DISABLED", "Stripe payments are not enabled");
  }
  createCheckout(): Promise<{ invoiceLink: string }> {
    throw new AppError(501, "PROVIDER_DISABLED", "Stripe payments are not enabled");
  }
  refund(): Promise<void> {
    throw new AppError(501, "PROVIDER_DISABLED", "Stripe payments are not enabled");
  }
}
