import { Injectable } from "@nestjs/common";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { AuditService } from "../../common/events.js";

const DAY = 86_400_000;

export type FraudKind = "SHARED_IP" | "CIRCULAR_TRADE" | "TRADE_FUNNEL" | "REFERRAL_CLUSTER" | "INCOME_SPIKE";

interface Finding {
  userId: string;
  kind: FraudKind;
  severity: 1 | 2 | 3;
  key: string;
  details: Record<string, unknown>;
}

/** Trust-score penalty per open (or confirmed) flag, by severity. */
const PENALTY = { 1: 5, 2: 15, 3: 30 } as const;

/**
 * Anti-fraud signals. Detectors are periodic, idempotent queries that raise review flags (one per
 * user and finding); they never punish on their own. Analysts dismiss or confirm flags in the
 * console, and suspension is a separate, audited action. Trust score = base + account age −
 * penalties for open/confirmed flags, and feeds reward decisions (e.g. referrals).
 */
@Injectable()
export class FraudService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** Accounts that signed in from the same (hashed) address as `userId` within the window. */
  async sharesIp(c: Queryable, a: string, b: string, days = 30): Promise<boolean> {
    const r = await row<{ n: number }>(
      c,
      `SELECT count(*)::int AS n FROM login_ips x JOIN login_ips y ON y.ip_hash = x.ip_hash
        WHERE x.user_id = $1 AND y.user_id = $2 AND x.last_seen > $3 AND y.last_seen > $3`,
      [a, b, new Date(this.clock.now().getTime() - days * DAY)],
    );
    return r!.n > 0;
  }

  async detect(): Promise<number> {
    const now = this.clock.now();
    const week = new Date(now.getTime() - 7 * DAY);
    const fortnight = new Date(now.getTime() - 14 * DAY);
    const findings: Finding[] = [];

    // 1. Three or more accounts on one address within a week (NAT/carrier-grade NAT is common,
    //    so this is low severity on its own).
    const clusters = await this.db.query<{ ip_hash: string; users: string[] }>(
      `SELECT ip_hash, array_agg(DISTINCT user_id::text) AS users FROM login_ips
        WHERE last_seen > $1 GROUP BY ip_hash HAVING count(DISTINCT user_id) >= 3`,
      [week],
    );
    for (const cl of clusters)
      for (const u of cl.users)
        findings.push({
          userId: u,
          kind: "SHARED_IP",
          severity: cl.users.length >= 6 ? 2 : 1,
          key: `ip:${cl.ip_hash}`,
          details: { accounts: cl.users.length, others: cl.users.filter((x) => x !== u).slice(0, 20) },
        });

    // 2. Circular trades: the same horse sold A → B and back B → A within two weeks.
    const circles = await this.db.query<{
      a: string;
      b: string;
      horse_id: string;
      first: string;
      second: string;
    }>(
      `SELECT l1.seller_id AS a, l1.buyer_id AS b, l1.horse_id, l1.id AS first, l2.id AS second
         FROM market_listings l1 JOIN market_listings l2
           ON l2.horse_id = l1.horse_id AND l2.seller_id = l1.buyer_id AND l2.buyer_id = l1.seller_id
          AND l2.closed_at > l1.closed_at AND l2.closed_at <= l1.closed_at + interval '14 days'
        WHERE l1.status = 'SOLD' AND l2.status = 'SOLD' AND l2.closed_at > $1`,
      [fortnight],
    );
    for (const x of circles)
      for (const [u, other] of [
        [x.a, x.b],
        [x.b, x.a],
      ] as const)
        findings.push({
          userId: u,
          kind: "CIRCULAR_TRADE",
          severity: 3,
          key: `circle:${x.first}:${x.second}`,
          details: { counterparty: other, horseId: x.horse_id, listings: [x.first, x.second] },
        });

    // 3. Trade funnel: one seller sells three or more horses to the same buyer in a week.
    const funnels = await this.db.query<{ seller_id: string; buyer_id: string; n: number; volume: number }>(
      `SELECT seller_id, buyer_id, count(*)::int AS n, sum(sale_price)::bigint AS volume FROM market_listings
        WHERE status = 'SOLD' AND closed_at > $1 GROUP BY seller_id, buyer_id HAVING count(*) >= 3`,
      [week],
    );
    for (const f of funnels)
      for (const [u, other] of [
        [f.seller_id, f.buyer_id],
        [f.buyer_id, f.seller_id],
      ] as const)
        findings.push({
          userId: u,
          kind: "TRADE_FUNNEL",
          severity: 2,
          key: `funnel:${[f.seller_id, f.buyer_id].sort().join(":")}:${week.toISOString().slice(0, 10)}`,
          details: { counterparty: other, sales: f.n, volume: Number(f.volume) },
        });

    // 4. Referral cluster: a referrer whose invitees sign in from the referrer's own address.
    const refs = await this.db.query<{ referrer: string; n: number; invitees: string[] }>(
      `SELECT u.referred_by AS referrer, count(DISTINCT u.id)::int AS n, array_agg(DISTINCT u.id::text) AS invitees
         FROM users u JOIN login_ips a ON a.user_id = u.id JOIN login_ips b ON b.user_id = u.referred_by
        WHERE b.ip_hash = a.ip_hash GROUP BY u.referred_by HAVING count(DISTINCT u.id) >= 2`,
    );
    for (const r of refs)
      findings.push({
        userId: r.referrer,
        kind: "REFERRAL_CLUSTER",
        severity: r.n >= 5 ? 3 : 2,
        key: `refs:${r.n >= 5 ? "many" : "some"}`,
        details: { invitees: r.invitees.slice(0, 20), count: r.n },
      });

    // 5. Income spike: yesterday's credit income above 10× the 90th percentile of earners.
    const spikes = await this.db.query<{ user_id: string; income: number; p90: number }>(
      `WITH daily AS (
         SELECT a.owner_id AS user_id, sum(e.amount)::bigint AS income
           FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
           JOIN ledger_transactions t ON t.id = e.tx_id
          WHERE a.owner_type = 'USER' AND a.currency = 'CREDITS' AND e.amount > 0
            AND e.created_at > $1 AND t.type NOT IN ('STARTER_GRANT', 'ADMIN_ADJUSTMENT')
          GROUP BY a.owner_id),
       p AS (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY income) AS p90, count(*) AS n FROM daily)
       SELECT d.user_id, d.income, p.p90 FROM daily d, p
        WHERE p.n >= 20 AND d.income > 10 * p.p90`,
      [new Date(now.getTime() - DAY)],
    );
    for (const s of spikes)
      findings.push({
        userId: s.user_id,
        kind: "INCOME_SPIKE",
        severity: 2,
        key: `income:${now.toISOString().slice(0, 10)}`,
        details: { income: Number(s.income), p90: Math.round(Number(s.p90)) },
      });

    let raised = 0;
    for (const f of findings) {
      const r = await this.db.query(
        `INSERT INTO fraud_flags (user_id, kind, severity, dedupe_key, details) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id`,
        [f.userId, f.kind, f.severity, f.key, JSON.stringify(f.details)],
      );
      raised += r.length;
    }
    if (raised > 0) await this.recomputeTrust();
    return raised;
  }

  /** Trust = 50 + up to 20 for account age (1 point / 3 days) − penalties for open/confirmed flags. */
  async recomputeTrust(userIds?: string[]): Promise<void> {
    await this.db.query(
      `UPDATE users u SET trust_score = GREATEST(0, LEAST(100,
          50 + LEAST(20, floor(extract(epoch FROM ($2::timestamptz - u.created_at)) / 259200))::int
          - COALESCE((SELECT sum(CASE f.severity WHEN 1 THEN ${PENALTY[1]} WHEN 2 THEN ${PENALTY[2]} ELSE ${PENALTY[3]} END)
                        FROM fraud_flags f WHERE f.user_id = u.id AND f.status IN ('OPEN','CONFIRMED')), 0)))
        WHERE u.role <> 'SYSTEM' AND ($1::uuid[] IS NULL OR u.id = ANY($1::uuid[]))`,
      [userIds ?? null, this.clock.now()],
    );
  }

  async list(status: "OPEN" | "DISMISSED" | "CONFIRMED", limit: number) {
    return this.db.query(
      `SELECT f.id, f.user_id, COALESCE(u.username, u.first_name) AS user_name, u.status AS user_status,
              u.trust_score, f.kind, f.severity, f.details, f.status, f.created_at, f.review_note,
              COALESCE(r.username, r.first_name) AS reviewer
         FROM fraud_flags f JOIN users u ON u.id = f.user_id LEFT JOIN users r ON r.id = f.reviewed_by
        WHERE f.status = $1 ORDER BY f.severity DESC, f.created_at DESC LIMIT $2`,
      [status, limit],
    );
  }

  async review(actorId: string, id: number, decision: "DISMISSED" | "CONFIRMED", note: string, ip: string) {
    const now = this.clock.now();
    const userId = await this.db.tx(async (c) => {
      const f = await row<{ id: number; user_id: string; status: string; kind: string }>(
        c,
        "SELECT id, user_id, status, kind FROM fraud_flags WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!f) throw notFound("Flag");
      if (f.status !== "OPEN") throw conflict("ALREADY_REVIEWED", `Flag is ${f.status.toLowerCase()}`);
      if (f.user_id === actorId) throw conflict("SELF_ACTION", "You cannot review your own flag");
      await c.query(
        "UPDATE fraud_flags SET status = $2, reviewed_by = $3, reviewed_at = $4, review_note = $5 WHERE id = $1",
        [id, decision, actorId, now, note],
      );
      await this.audit.log(c, {
        actorId,
        action: `FRAUD_FLAG_${decision}`,
        targetType: "user",
        targetId: f.user_id,
        before: { flag: id, kind: f.kind, status: f.status },
        after: { status: decision },
        reason: note,
        ip,
      });
      return f.user_id;
    });
    await this.recomputeTrust([userId]);
    return { id, status: decision };
  }
}
