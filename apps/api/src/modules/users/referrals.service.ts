import { Injectable } from "@nestjs/common";
import type { ReferralDto } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { LedgerService } from "../economy/ledger.service.js";
import { FraudService } from "../fraud/fraud.service.js";

export const REFERRAL_REWARD = 500;
const DAILY_CAP = 10;
const MIN_AGE_MS = 24 * 3_600_000;
/** Referrers below this trust score do not earn referral rewards (the invitee still does). */
const MIN_TRUST = 30;
/** Invitees older than this are no longer checked by the sweep. */
const SWEEP_WINDOW_MS = 30 * 86_400_000;

const refereeKey = (id: string) => `referral:${id}:referee`;
/** Review flag for an invite that shares a private network with its referrer. */
const reviewKey = (referrer: string) => `refnet:${referrer}`;
type Review = "NONE" | "OPEN" | "DISMISSED" | "CONFIRMED";
const referrerKey = (id: string) => `referral:${id}:referrer`;

/**
 * Invite rewards: both sides get credits once the invitee has run a race and their account is a
 * day old (anti-abuse). An invitee on the referrer's private network (not a public carrier
 * gateway) is held for an analyst's review instead of being paid or refused automatically.
 * Checked when a race settles and by a background sweep, so a race on day one pays out later.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly fraud: FraudService,
    private readonly clock: Clock,
  ) {}

  /** Pay whatever is due for this invitee (idempotent). */
  async rewardIfDue(c: Queryable, userId: string, now: Date): Promise<void> {
    const u = await row<{ referred_by: string | null; created_at: Date }>(
      c,
      "SELECT referred_by, created_at FROM users WHERE id = $1",
      [userId],
    );
    if (!u?.referred_by) return;
    if (now.getTime() - u.created_at.getTime() < MIN_AGE_MS) return;
    if (!(await this.hasRaced(c, userId))) return;
    const review = await this.review(c, userId, u.referred_by);
    if (review === "OPEN" || review === "CONFIRMED") return;
    if (review === "NONE" && (await this.fraud.sharesPrivateNetwork(c, userId, u.referred_by))) {
      await c.query(
        `INSERT INTO fraud_flags (user_id, kind, severity, dedupe_key, details)
         VALUES ($1, 'REFERRAL_SHARED_IP', 1, $2, $3) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        [
          userId,
          reviewKey(u.referred_by),
          JSON.stringify({ referrer: u.referred_by, reward: REFERRAL_REWARD }),
        ],
      );
      return;
    }
    const meta = { referrer: u.referred_by, referee: userId };
    await this.ledger.credit(c, {
      userId,
      currency: "CREDITS",
      amount: REFERRAL_REWARD,
      source: "REFERRAL_REWARD",
      key: refereeKey(userId),
      type: "REFERRAL_REWARD_REFEREE",
      reason: "Invited by a friend",
      metadata: meta,
    });
    if (await this.paid(c, referrerKey(userId))) return;
    const trust = await row<{ trust_score: number }>(c, "SELECT trust_score FROM users WHERE id = $1", [
      u.referred_by,
    ]);
    if ((trust?.trust_score ?? 0) < MIN_TRUST) return;
    const recent = await row<{ n: number }>(
      c,
      `SELECT count(*)::int AS n FROM ledger_transactions
        WHERE type = 'REFERRAL_REWARD' AND metadata->>'referrer' = $1 AND created_at > $2`,
      [u.referred_by, new Date(now.getTime() - 86_400_000)],
    );
    // Over the daily cap: the sweep pays the referrer on a later day.
    if (recent!.n >= DAILY_CAP) return;
    await this.ledger.credit(c, {
      userId: u.referred_by,
      currency: "CREDITS",
      amount: REFERRAL_REWARD,
      source: "REFERRAL_REWARD",
      key: referrerKey(userId),
      type: "REFERRAL_REWARD",
      reason: "Your friend joined the races",
      metadata: meta,
    });
  }

  /** Background catch-up for invitees who qualified after their race settled. */
  async sweep(limit = 100): Promise<number> {
    const now = this.clock.now();
    await this.db.query("DELETE FROM pending_start_params WHERE created_at < $1", [
      new Date(now.getTime() - 7 * 86_400_000),
    ]);
    const due = await this.db.query<{ id: string }>(
      `SELECT u.id FROM users u
        WHERE u.referred_by IS NOT NULL AND u.status = 'ACTIVE'
          AND u.created_at < $1 AND u.created_at > $2
          AND (NOT EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'referral:' || u.id || ':referee')
            OR NOT EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'referral:' || u.id || ':referrer'))
          AND EXISTS (SELECT 1 FROM race_entries e WHERE e.owner_id = u.id AND e.status = 'RAN' AND NOT e.is_house)
        ORDER BY u.created_at LIMIT $3`,
      [new Date(now.getTime() - MIN_AGE_MS), new Date(now.getTime() - SWEEP_WINDOW_MS), limit],
    );
    let paid = 0;
    for (const { id } of due) {
      const before = await this.paid(this.db.pool, refereeKey(id));
      await this.db.tx(async (c) => {
        // One worker per invitee at a time.
        const locked = await row(c, "SELECT id FROM users WHERE id = $1 FOR UPDATE SKIP LOCKED", [id]);
        if (locked) await this.rewardIfDue(c, id, now);
      });
      if (!before && (await this.paid(this.db.pool, refereeKey(id)))) paid++;
    }
    return paid;
  }

  /** The referrer's invitees and where each one stands. */
  async list(referrerId: string): Promise<ReferralDto[]> {
    const now = this.clock.now();
    const rows = await this.db.query<{
      id: string;
      name: string;
      created_at: Date;
      raced: boolean;
      paid: boolean;
    }>(
      `SELECT u.id, COALESCE(u.first_name, u.username, 'Owner') AS name, u.created_at,
              EXISTS (SELECT 1 FROM race_entries e WHERE e.owner_id = u.id AND e.status = 'RAN' AND NOT e.is_house) AS raced,
              EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'referral:' || u.id || ':referrer') AS paid
         FROM users u WHERE u.referred_by = $1 ORDER BY u.created_at DESC LIMIT 50`,
      [referrerId],
    );
    const out: ReferralDto[] = [];
    for (const r of rows) {
      const readyAt = new Date(r.created_at.getTime() + MIN_AGE_MS);
      const review = r.paid ? "DISMISSED" : await this.review(this.db.pool, r.id, referrerId);
      const status: ReferralDto["status"] = r.paid
        ? "PAID"
        : review === "CONFIRMED"
          ? "SAME_NETWORK"
          : review === "OPEN"
            ? "REVIEW"
            : !r.raced
              ? "WAITING_RACE"
              : readyAt > now
                ? "WAITING_DAY"
                : "PROCESSING";
      out.push({
        name: r.name,
        joinedAt: r.created_at.toISOString(),
        status,
        readyAt: status === "WAITING_DAY" || status === "WAITING_RACE" ? readyAt.toISOString() : null,
      });
    }
    return out;
  }

  private async review(c: Queryable, referee: string, referrer: string): Promise<Review> {
    const f = await row<{ status: Review }>(
      c,
      "SELECT status FROM fraud_flags WHERE user_id = $1 AND dedupe_key = $2",
      [referee, reviewKey(referrer)],
    );
    return f?.status ?? "NONE";
  }

  private async hasRaced(c: Queryable, userId: string): Promise<boolean> {
    return !!(await row(
      c,
      "SELECT 1 FROM race_entries WHERE owner_id = $1 AND status = 'RAN' AND NOT is_house LIMIT 1",
      [userId],
    ));
  }

  private async paid(c: Queryable, key: string): Promise<boolean> {
    return !!(await row(c, "SELECT id FROM ledger_transactions WHERE idempotency_key = $1", [key]));
  }
}
