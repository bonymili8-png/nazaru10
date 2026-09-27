import { Inject, Injectable } from "@nestjs/common";
import type { SubscriptionDto, SubscriptionStatus } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { conflict } from "../../common/errors.js";
import { LOGGER, type Logger } from "../../common/logger.js";
import { PRODUCTS } from "./catalog.js";
import { TelegramStarsProvider } from "./payment-provider.js";

/** Renewals can land a little after the period ends; keep benefits for this grace window. */
const GRACE_MS = 24 * 3_600_000;

interface SubRow {
  status: SubscriptionStatus;
  period_end: Date;
  charge_id: string;
  telegram_id: number;
}

/**
 * Owners' Circle membership (a Telegram Stars subscription). Payments and renewals are granted by
 * PaymentsService from the verified bot webhook; this service reads the state and lets members
 * cancel (benefits last until the paid period ends) or resume before it ends.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly db: Db,
    private readonly stars: TelegramStarsProvider,
    private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  private get product() {
    return PRODUCTS.find((p) => p.subscriptionDays)!;
  }

  private load(userId: string) {
    return this.db.one<SubRow>(
      `SELECT s.status, s.period_end, s.charge_id, u.telegram_id
         FROM subscriptions s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1`,
      [userId],
    );
  }

  async view(userId: string): Promise<SubscriptionDto> {
    const s = await this.load(userId);
    const p = this.product;
    return {
      productId: p.id,
      priceStars: p.priceStars,
      periodDays: p.subscriptionDays!,
      gemsPerPeriod: p.grants.gems ?? 0,
      status: s?.status ?? null,
      member: !!s && s.status !== "EXPIRED" && s.period_end > this.clock.now(),
      periodEnd: s?.period_end.toISOString() ?? null,
    };
  }

  async cancel(userId: string): Promise<SubscriptionDto> {
    const s = await this.load(userId);
    if (!s || s.status !== "ACTIVE") throw conflict("NOT_SUBSCRIBED", "No active membership to cancel");
    // Telegram first: if it refuses, nothing changes here.
    await this.stars.cancelSubscription(s.telegram_id, s.charge_id);
    await this.db.query(
      "UPDATE subscriptions SET status = 'CANCELED', canceled_at = $2, updated_at = $2 WHERE user_id = $1",
      [userId, this.clock.now()],
    );
    return this.view(userId);
  }

  async resume(userId: string): Promise<SubscriptionDto> {
    const s = await this.load(userId);
    if (!s || s.status !== "CANCELED" || s.period_end <= this.clock.now())
      throw conflict("NOT_RESUMABLE", "Subscribe again instead");
    await this.stars.resumeSubscription(s.telegram_id, s.charge_id);
    await this.db.query(
      "UPDATE subscriptions SET status = 'ACTIVE', canceled_at = NULL, updated_at = $2 WHERE user_id = $1",
      [userId, this.clock.now()],
    );
    return this.view(userId);
  }

  /** End memberships whose paid period (plus grace for late renewals) is over. */
  async expireDue(): Promise<number> {
    const r = await this.db.query(
      `UPDATE subscriptions SET status = 'EXPIRED', updated_at = $1
        WHERE status <> 'EXPIRED' AND period_end < $2 RETURNING user_id`,
      [this.clock.now(), new Date(this.clock.now().getTime() - GRACE_MS)],
    );
    if (r.length) this.logger.info({ n: r.length }, "memberships expired");
    return r.length;
  }
}
