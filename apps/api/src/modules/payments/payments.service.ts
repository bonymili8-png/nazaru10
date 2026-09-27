import { Inject, Injectable } from "@nestjs/common";
import type { PaymentDto, ProductDto } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { AuditService, EventsService } from "../../common/events.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { LedgerService } from "../economy/ledger.service.js";
import { type Product, productById, PRODUCTS } from "./catalog.js";
import { TelegramStarsProvider } from "./payment-provider.js";

interface PaymentRow {
  id: string;
  user_id: string;
  provider: "TELEGRAM_STARS" | "STRIPE";
  product_id: string;
  amount: number;
  currency: string;
  status: PaymentDto["status"];
  invoice_link: string | null;
  provider_charge_id: string | null;
}

export interface PreCheckoutQuery {
  id: string;
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
  /** Subscriptions: unix time the paid period ends. */
  subscription_expiration_date?: number;
  /** Subscriptions: true for automatic renewals (the first payment is not recurring). */
  is_recurring?: boolean;
  is_first_recurring?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payment state machine CREATED → PENDING → COMPLETED (→ REFUNDED). Entitlements are granted
 * only from the verified bot-webhook `successful_payment` update — never from the client.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly stars: TelegramStarsProvider,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  products(): ProductDto[] {
    return PRODUCTS.map(({ oncePerUser: _once, ...p }) => p);
  }

  private toDto(p: PaymentRow): PaymentDto {
    return {
      id: p.id,
      productId: p.product_id,
      status: p.status,
      invoiceLink: p.invoice_link,
      amount: p.amount,
      currency: p.currency,
    };
  }

  async create(userId: string, productId: string): Promise<PaymentDto> {
    const product = productById(productId);
    if (!product) throw notFound("Product");
    if (product.subscriptionDays) {
      const active = await this.db.one(
        "SELECT 1 FROM subscriptions WHERE user_id = $1 AND status <> 'EXPIRED' AND period_end > $2",
        [userId, this.clock.now()],
      );
      if (active) throw conflict("ALREADY_SUBSCRIBED", "You are already an Owners' Circle member");
    }
    if (product.oncePerUser) {
      const prior = await this.db.one(
        "SELECT 1 FROM payments WHERE user_id = $1 AND product_id = $2 AND status IN ('COMPLETED','REFUNDED')",
        [userId, productId],
      );
      if (prior) throw conflict("ALREADY_PURCHASED", "This pack can only be bought once");
    }
    const p = await this.db.one<PaymentRow>(
      "INSERT INTO payments (user_id, provider, product_id, amount, currency) VALUES ($1, 'TELEGRAM_STARS', $2, $3, $4) RETURNING *",
      [userId, productId, this.stars.price(product), this.stars.currency],
    );
    try {
      const { invoiceLink } = await this.stars.createCheckout(p!.id, product);
      const updated = await this.db.one<PaymentRow>(
        "UPDATE payments SET invoice_link = $2, updated_at = now() WHERE id = $1 RETURNING *",
        [p!.id, invoiceLink],
      );
      return this.toDto(updated!);
    } catch (err) {
      await this.db.query(
        "UPDATE payments SET status = 'FAILED', failure_reason = $2, updated_at = now() WHERE id = $1",
        [p!.id, String((err as Error).message).slice(0, 500)],
      );
      this.logger.error({ err, paymentId: p!.id }, "invoice creation failed");
      throw conflict("PAYMENT_UNAVAILABLE", "Payments are temporarily unavailable");
    }
  }

  async get(userId: string, id: string): Promise<PaymentDto> {
    const p = await this.db.one<PaymentRow>("SELECT * FROM payments WHERE id = $1 AND user_id = $2", [
      id,
      userId,
    ]);
    if (!p) throw notFound("Payment");
    return this.toDto(p);
  }

  /** Validate a pre-checkout query. Returns the answer to send back to Telegram. */
  async preCheckout(q: PreCheckoutQuery): Promise<{ ok: boolean; error?: string }> {
    if (!UUID.test(q.invoice_payload)) return { ok: false, error: "Unknown order" };
    return this.db.tx(async (c) => {
      const p = await row<PaymentRow & { telegram_id: number }>(
        c,
        "SELECT p.*, u.telegram_id FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = $1 FOR UPDATE OF p",
        [q.invoice_payload],
      );
      if (!p) return { ok: false, error: "Unknown order" };
      if (p.telegram_id !== q.from.id) return { ok: false, error: "This order belongs to another account" };
      if (p.currency !== q.currency || p.amount !== q.total_amount)
        return { ok: false, error: "Price changed — please try again" };
      if (p.status !== "CREATED" && p.status !== "PENDING")
        return { ok: false, error: "This order is no longer valid" };
      const product = productById(p.product_id);
      if (!product) return { ok: false, error: "Product unavailable" };
      await c.query("UPDATE payments SET status = 'PENDING', updated_at = now() WHERE id = $1", [p.id]);
      return { ok: true };
    });
  }

  /** Grant the purchase. Idempotent on the Telegram charge id and on the payment id. */
  async complete(
    fromTelegramId: number,
    sp: SuccessfulPayment,
  ): Promise<"COMPLETED" | "DUPLICATE" | "REJECTED"> {
    if (!UUID.test(sp.invoice_payload)) return "REJECTED";
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const p = await row<PaymentRow & { telegram_id: number }>(
        c,
        "SELECT p.*, u.telegram_id FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = $1 FOR UPDATE OF p",
        [sp.invoice_payload],
      );
      if (!p) {
        this.logger.error({ sp }, "successful_payment for unknown payment");
        return "REJECTED";
      }
      if (p.provider_charge_id === sp.telegram_payment_charge_id) return "DUPLICATE";
      const product = productById(p.product_id)!;
      // Automatic subscription renewal: Telegram reuses the first invoice's payload.
      if (product.subscriptionDays && sp.is_recurring && p.status === "COMPLETED") {
        if (p.telegram_id !== fromTelegramId || p.currency !== sp.currency || p.amount !== sp.total_amount) {
          this.logger.error({ paymentId: p.id, sp }, "subscription renewal does not match the order");
          return "REJECTED";
        }
        return this.renew(c, p, product, sp, now);
      }
      if (p.status === "COMPLETED" || p.status === "REFUNDED") {
        this.logger.error({ paymentId: p.id, sp }, "second charge for an already completed payment");
        return "DUPLICATE";
      }
      if (p.telegram_id !== fromTelegramId || p.currency !== sp.currency || p.amount !== sp.total_amount) {
        this.logger.error({ paymentId: p.id, sp }, "successful_payment does not match the order");
        await c.query(
          "UPDATE payments SET failure_reason = 'MISMATCH', provider_payload = $2, updated_at = now() WHERE id = $1",
          [p.id, JSON.stringify(sp)],
        );
        return "REJECTED";
      }
      await c.query(
        `UPDATE payments SET status = 'COMPLETED', provider_charge_id = $2, provider_payload = $3, completed_at = $4, updated_at = $4
          WHERE id = $1`,
        [p.id, sp.telegram_payment_charge_id, JSON.stringify(sp), now],
      );
      if (product.grants.gems) {
        await this.ledger.credit(c, {
          userId: p.user_id,
          currency: "GEMS",
          amount: product.grants.gems,
          source: "PAYMENTS",
          key: `payment:${p.id}`,
          type: "PURCHASE",
          reason: product.title,
          metadata: { paymentId: p.id, productId: p.product_id },
        });
      }
      if (product.subscriptionDays) await this.startPeriod(c, p.user_id, product, sp, now);
      await this.events.emit(c, {
        type: "payment_completed",
        aggregateType: "payment",
        aggregateId: p.id,
        actorId: p.user_id,
        payload: { userId: p.user_id, productId: p.product_id, amount: p.amount, currency: p.currency },
      });
      return "COMPLETED";
    });
  }

  /** Record the paid period of a subscription (first payment or renewal). */
  private async startPeriod(
    c: Queryable,
    userId: string,
    product: Product,
    sp: SuccessfulPayment,
    now: Date,
  ) {
    const periodEnd = sp.subscription_expiration_date
      ? new Date(sp.subscription_expiration_date * 1000)
      : new Date(now.getTime() + product.subscriptionDays! * 86_400_000);
    await c.query(
      `INSERT INTO subscriptions (user_id, product_id, status, period_end, charge_id, started_at, updated_at)
       VALUES ($1,$2,'ACTIVE',$3,$4,$5,$5)
       ON CONFLICT (user_id) DO UPDATE SET product_id = EXCLUDED.product_id, status = 'ACTIVE',
         period_end = GREATEST(EXCLUDED.period_end, subscriptions.period_end), charge_id = EXCLUDED.charge_id,
         canceled_at = NULL, updated_at = EXCLUDED.updated_at,
         started_at = CASE WHEN subscriptions.status = 'EXPIRED' THEN EXCLUDED.started_at ELSE subscriptions.started_at END`,
      [userId, product.id, periodEnd, sp.telegram_payment_charge_id, now],
    );
  }

  /** A renewal charge: its own payment row (child of the first), gems for the period, a longer period. */
  private async renew(
    c: Queryable,
    first: PaymentRow,
    product: Product,
    sp: SuccessfulPayment,
    now: Date,
  ): Promise<"COMPLETED" | "DUPLICATE"> {
    const seen = await row(c, "SELECT 1 FROM payments WHERE provider_charge_id = $1", [
      sp.telegram_payment_charge_id,
    ]);
    if (seen) return "DUPLICATE";
    const renewal = await row<{ id: string }>(
      c,
      `INSERT INTO payments (user_id, provider, product_id, amount, currency, status, provider_charge_id,
                             provider_payload, completed_at, parent_id)
       VALUES ($1,'TELEGRAM_STARS',$2,$3,$4,'COMPLETED',$5,$6,$7,$8) RETURNING id`,
      [
        first.user_id,
        first.product_id,
        first.amount,
        first.currency,
        sp.telegram_payment_charge_id,
        JSON.stringify(sp),
        now,
        first.id,
      ],
    );
    if (product.grants.gems)
      await this.ledger.credit(c, {
        userId: first.user_id,
        currency: "GEMS",
        amount: product.grants.gems,
        source: "PAYMENTS",
        key: `payment:${renewal!.id}`,
        type: "PURCHASE",
        reason: `${product.title} — renewal`,
        metadata: { paymentId: renewal!.id, productId: product.id, parentId: first.id },
      });
    await this.startPeriod(c, first.user_id, product, sp, now);
    await this.events.emit(c, {
      type: "subscription_renewed",
      aggregateType: "payment",
      aggregateId: renewal!.id,
      actorId: first.user_id,
      payload: { userId: first.user_id, productId: product.id, gems: product.grants.gems ?? 0 },
    });
    return "COMPLETED";
  }

  /** Support/finance refund: claws back the granted gems, then refunds the Stars. */
  async refund(actorId: string, paymentId: string, reason: string): Promise<PaymentDto> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const p = await row<PaymentRow & { telegram_id: number }>(
        c,
        "SELECT p.*, u.telegram_id FROM payments p JOIN users u ON u.id = p.user_id WHERE p.id = $1 FOR UPDATE OF p",
        [paymentId],
      );
      if (!p) throw notFound("Payment");
      if (p.status !== "COMPLETED") throw conflict("NOT_REFUNDABLE", `Payment is ${p.status}`);
      const product = productById(p.product_id)!;
      if (product.grants.gems) {
        await this.ledger.debit(c, {
          userId: p.user_id,
          currency: "GEMS",
          amount: product.grants.gems,
          sink: "PAYMENTS",
          key: `payment:${p.id}:refund`,
          type: "REFUND",
          reason,
          actorId,
        });
      }
      await c.query(
        "UPDATE payments SET status = 'REFUNDED', refunded_at = $2, updated_at = $2 WHERE id = $1",
        [p.id, now],
      );
      // Refunding a membership payment ends the membership (and stops renewals at Telegram).
      let stopRenewals: string | null = null;
      if (product.subscriptionDays) {
        const sub = await row<{ charge_id: string; status: string }>(
          c,
          "UPDATE subscriptions SET status = 'EXPIRED', period_end = $2, updated_at = $2 WHERE user_id = $1 RETURNING charge_id, status",
          [p.user_id, now],
        );
        stopRenewals = sub?.charge_id ?? null;
      }
      await this.audit.log(c, {
        actorId,
        action: "PAYMENT_REFUND",
        targetType: "payment",
        targetId: p.id,
        reason,
        before: { status: p.status },
      });
      await this.events.emit(c, {
        type: "payment_refunded",
        aggregateType: "payment",
        aggregateId: p.id,
        actorId,
        payload: { userId: p.user_id },
      });
      // External call last: if Telegram rejects the refund the whole transaction rolls back.
      await this.stars.refund({ userTelegramId: p.telegram_id, chargeId: p.provider_charge_id! });
      if (stopRenewals)
        await this.stars
          .cancelSubscription(p.telegram_id, stopRenewals)
          .catch((err: unknown) =>
            this.logger.warn({ err, paymentId: p.id }, "could not cancel subscription"),
          );
      return this.toDto({ ...p, status: "REFUNDED" });
    });
  }
}
