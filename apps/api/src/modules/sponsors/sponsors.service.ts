import { Injectable } from "@nestjs/common";
import type { SponsorContractDto, SponsorsDto } from "@thoroughline/contracts";
import {
  type SponsorDef,
  type SponsoredRun,
  sponsorOffers,
  sponsorQualifies,
  sponsorWeek,
  sponsorWeekStart,
} from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";

interface ContractRow {
  id: string;
  user_id: string;
  sponsor_code: string;
  week: number;
  target: number;
  progress: number;
  reward: number;
  reputation: number;
  status: "ACTIVE" | "COMPLETED" | "EXPIRED";
  expires_at: Date;
  completed_at: Date | null;
}

/**
 * Sponsors: each week an owner is offered three contracts and may sign one. A contract counts
 * qualifying finishes (by result, surface, distance or going) for `contractDays` and pays its
 * reward once the goal is reached. Rewards are credits and reputation only — never race power.
 */
@Injectable()
export class SponsorsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  private def(code: string): SponsorDef | undefined {
    return this.config.get().sponsors.catalog.find((s) => s.code === code);
  }

  private dto(r: ContractRow): SponsorContractDto | null {
    const d = this.def(r.sponsor_code);
    if (!d) return null;
    return {
      code: d.code,
      name: d.name,
      goal: { ...d.goal, count: r.target },
      reward: r.reward,
      reputation: r.reputation,
      id: r.id,
      progress: r.progress,
      status: r.status,
      expiresAt: r.expires_at.toISOString(),
      completedAt: r.completed_at?.toISOString() ?? null,
    };
  }

  async view(userId: string): Promise<SponsorsDto> {
    await this.expireDue(userId);
    const now = this.clock.now();
    const week = sponsorWeek(now);
    const cfg = this.config.get();
    const contracts = await this.db.query<ContractRow>(
      "SELECT * FROM sponsor_contracts WHERE user_id = $1 ORDER BY accepted_at DESC LIMIT 6",
      [userId],
    );
    const active = contracts.find((c) => c.status === "ACTIVE") ?? null;
    return {
      week,
      weekEndsAt: sponsorWeekStart(week + 1).toISOString(),
      offers: sponsorOffers(userId, week, cfg).map((d) => ({
        code: d.code,
        name: d.name,
        goal: d.goal,
        reward: d.reward,
        reputation: d.reputation,
      })),
      active: active ? this.dto(active) : null,
      signedThisWeek: contracts.some((c) => c.week === week),
      history: contracts
        .filter((c) => c.status !== "ACTIVE")
        .map((c) => this.dto(c)!)
        .filter(Boolean),
    };
  }

  async sign(userId: string, code: string): Promise<SponsorsDto> {
    const now = this.clock.now();
    const week = sponsorWeek(now);
    const offer = sponsorOffers(userId, week, this.config.get()).find((d) => d.code === code);
    if (!offer) throw notFound("Sponsor offer");
    await this.expireDue(userId);
    try {
      await this.db.query(
        `INSERT INTO sponsor_contracts (user_id, sponsor_code, week, target, reward, reputation, accepted_at, expires_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
          WHERE NOT EXISTS (SELECT 1 FROM sponsor_contracts WHERE user_id = $1 AND week = $3)`,
        [
          userId,
          code,
          week,
          offer.goal.count,
          offer.reward,
          offer.reputation,
          now,
          new Date(now.getTime() + this.config.get().sponsors.contractDays * 86_400_000),
        ],
      );
    } catch (err) {
      if ((err as { code?: string }).code === "23505")
        throw conflict("SPONSOR_ACTIVE", "You already have an active sponsor");
      throw err;
    }
    const signed = await row<{ id: string }>(
      this.db.pool,
      "SELECT id FROM sponsor_contracts WHERE user_id = $1 AND week = $2 AND sponsor_code = $3",
      [userId, week, code],
    );
    if (!signed) throw conflict("SPONSOR_WEEK_USED", "You already signed a sponsor this week");
    return this.view(userId);
  }

  /** Count one finished run (called when a race settles, inside its transaction). */
  async onRun(c: Queryable, userId: string, run: SponsoredRun, now: Date): Promise<void> {
    const k = await row<ContractRow>(
      c,
      "SELECT * FROM sponsor_contracts WHERE user_id = $1 AND status = 'ACTIVE' AND expires_at > $2 FOR UPDATE",
      [userId, now],
    );
    if (!k) return;
    const d = this.def(k.sponsor_code);
    if (!d || !sponsorQualifies({ ...d.goal, count: k.target }, run)) return;
    const progress = k.progress + 1;
    if (progress < k.target) {
      await c.query("UPDATE sponsor_contracts SET progress = $2 WHERE id = $1", [k.id, progress]);
      return;
    }
    await c.query(
      "UPDATE sponsor_contracts SET progress = $2, status = 'COMPLETED', completed_at = $3 WHERE id = $1",
      [k.id, progress, now],
    );
    if (k.reward > 0)
      await this.ledger.credit(c, {
        userId,
        currency: "CREDITS",
        amount: k.reward,
        source: "SPONSORS",
        key: `sponsor:${k.id}:credits`,
        type: "SPONSOR_REWARD",
        reason: d.name,
        metadata: { contractId: k.id, sponsor: d.code },
      });
    if (k.reputation > 0)
      await this.ledger.credit(c, {
        userId,
        currency: "REPUTATION",
        amount: k.reputation,
        source: "SPONSORS",
        key: `sponsor:${k.id}:reputation`,
        type: "SPONSOR_REWARD",
        reason: d.name,
        metadata: { contractId: k.id, sponsor: d.code },
      });
    await this.events.emit(c, {
      type: "sponsor_completed",
      aggregateType: "sponsor",
      aggregateId: k.id,
      actorId: userId,
      payload: { userId, sponsor: d.name, reward: k.reward },
    });
  }

  /** Close contracts whose week ended (all owners, or one). */
  async expireDue(userId?: string): Promise<number> {
    const r = await this.db.query(
      `UPDATE sponsor_contracts SET status = 'EXPIRED'
        WHERE status = 'ACTIVE' AND expires_at <= $1 AND ($2::uuid IS NULL OR user_id = $2) RETURNING id`,
      [this.clock.now(), userId ?? null],
    );
    return r.length;
  }
}
