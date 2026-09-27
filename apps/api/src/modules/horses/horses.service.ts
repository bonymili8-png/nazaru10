import { Injectable } from "@nestjs/common";
import type {
  ConditionDto,
  FeedDto,
  HorseDetailDto,
  HorseSummaryDto,
  ShopHorseDto,
  TrainingSessionDto,
} from "@thoroughline/contracts";
import {
  ageInYears,
  type Condition,
  FEED_PLANS,
  feedCost,
  feedEffect,
  type HorseStatus,
  hoursUntilFatigue,
  lifeStage,
  horseValuation,
  potentialStars,
  projectCondition,
  SURFACES,
} from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, rows } from "../../common/db.js";
import { conflict, forbidden, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { round } from "@thoroughline/engine";
import { LedgerService } from "../economy/ledger.service.js";
import { getHorse, type HorseRow } from "./horse.repo.js";

@Injectable()
export class HorsesService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  age(h: HorseRow, now: Date): number {
    return ageInYears(h.birth_at, now, this.config.get());
  }

  /** Condition projected to `now` (lazy fatigue recovery / health regen / form decay). */
  condition(h: HorseRow, now: Date): Condition {
    return projectCondition(
      { fatigue: h.fatigue, health: h.health, form: h.form, updatedAt: h.condition_updated_at },
      now,
      h.attributes.endurance,
      this.config.get(),
      feedEffect(h.feed_plan, this.config.get()),
    );
  }

  /** Status as the player sees it: healed injuries read as IDLE before they are persisted. */
  effectiveStatus(h: HorseRow, now: Date): HorseStatus {
    return h.status === "INJURED" && h.injured_until && h.injured_until <= now ? "IDLE" : h.status;
  }

  /**
   * Persist lazy state before a mutation: heal expired injuries and fold the condition
   * projection into the stored columns. Call with the horse row locked.
   */
  async normalize(c: Queryable, h: HorseRow, now: Date): Promise<HorseRow> {
    const cond = this.condition(h, now);
    const status = this.effectiveStatus(h, now);
    const res = await c.query<HorseRow>(
      `UPDATE horses SET fatigue = $2, health = $3, form = $4, condition_updated_at = $5, status = $6,
              injured_until = CASE WHEN $6 = 'IDLE' THEN NULL ELSE injured_until END, updated_at = $5
        WHERE id = $1 RETURNING *`,
      [h.id, round(cond.fatigue, 2), round(cond.health, 2), round(cond.form, 3), now, status],
    );
    return res.rows[0]!;
  }

  conditionDto(h: HorseRow, now: Date): ConditionDto {
    const cond = this.condition(h, now);
    const cfg = this.config.get();
    return {
      fatigue: round(cond.fatigue, 1),
      health: round(cond.health, 1),
      form: round(cond.form, 2),
      hoursToRaceReady: round(
        hoursUntilFatigue(
          cond.fatigue,
          cfg.condition.maxFatigueToRace,
          h.attributes.endurance,
          cfg,
          feedEffect(h.feed_plan, cfg).recovery,
        ),
        2,
      ),
    };
  }

  /** The horse's feed plan and the plans on offer (see NutritionService). */
  feedDto(h: HorseRow): FeedDto {
    const cfg = this.config.get();
    return {
      plan: h.feed_plan,
      paidUntil: h.feed_paid_until?.toISOString() ?? null,
      renews: h.feed_plan !== "STANDARD" && h.feed_renews,
      options: FEED_PLANS.map((plan) => {
        const p = plan === "STANDARD" ? null : cfg.nutrition.plans[plan];
        return {
          plan,
          weeklyCost: feedCost(plan, cfg),
          recovery: p?.recovery ?? 1,
          regen: p?.regen ?? 1,
          formDecay: p?.formDecay ?? 1,
        };
      }),
    };
  }

  summary(h: HorseRow, now: Date, ownerName: string | null = null): HorseSummaryDto {
    const age = this.age(h, now);
    return {
      id: h.id,
      name: h.name,
      sex: h.sex,
      age: round(age, 1),
      stage: lifeStage(age, this.config.get()),
      rarity: h.rarity,
      coat: h.coat,
      bloodline: h.bloodline,
      status: this.effectiveStatus(h, now),
      abilityRating: h.ability_rating,
      raceRating: h.race_rating,
      record: { starts: h.starts, wins: h.wins, seconds: h.seconds, thirds: h.thirds, earnings: h.earnings },
      ownerId: h.owner_id,
      ownerName,
      isHouse: h.is_house,
      cloth: h.is_house ? null : h.cloth,
    };
  }

  /** Buyer-facing card: public summary plus the scouting info a buyer can see before paying. */
  marketCard(h: HorseRow, now: Date, price: number, ownerName: string | null = null): ShopHorseDto {
    const surfaces = h.genome.aptitudes.surface;
    return {
      ...this.summary(h, now, ownerName),
      price,
      potentialStars: potentialStars(h.genome),
      optimalDistance: h.genome.aptitudes.optimalDistance,
      favouriteSurface: [...SURFACES].sort((a, b) => surfaces[b] - surfaces[a])[0]!,
    };
  }

  /** Reference market value (valuation model) used for price sanity bands. */
  valuation(h: HorseRow, now: Date): number {
    return horseValuation(h.genome, h.attributes, this.age(h, now));
  }

  detail(
    h: HorseRow,
    viewerId: string | null,
    now: Date,
    ownerName: string | null,
    activeTraining: TrainingSessionDto | null,
    listingId: string | null = null,
    studFee: number | null = null,
    follow: { followed: boolean; followers: number } = { followed: false, followers: 0 },
  ): HorseDetailDto {
    const isOwner = viewerId !== null && h.owner_id === viewerId;
    return {
      ...this.summary(h, now, ownerName),
      ...follow,
      private: isOwner
        ? {
            attributes: h.attributes,
            traits: h.genome.traits,
            aptitudes: h.genome.aptitudes,
            potentialStars: potentialStars(h.genome),
            marketValue: this.valuation(h, now),
            listingId,
            studFee,
            condition: this.conditionDto(h, now),
            feed: this.feedDto(h),
            injuredUntil:
              this.effectiveStatus(h, now) === "INJURED" ? (h.injured_until?.toISOString() ?? null) : null,
            activeTraining,
            diagnostics: h.diagnosed_at
              ? {
                  ceilings: h.genome.ceilings,
                  injurySusceptibility: h.genome.hidden.injurySusceptibility,
                  maturity: h.genome.hidden.maturity,
                  raceIntelligence: h.genome.hidden.raceIntelligence,
                }
              : null,
          }
        : null,
    };
  }

  /** Whether `userId` follows the horse, and how many players do. */
  async followInfo(horseId: string, userId: string): Promise<{ followed: boolean; followers: number }> {
    const r = await rows<{ followed: boolean; followers: number }>(
      this.db.pool,
      `SELECT bool_or(user_id = $2) IS TRUE AS followed, count(*)::int AS followers
         FROM horse_follows WHERE horse_id = $1`,
      [horseId, userId],
    );
    return r[0] ?? { followed: false, followers: 0 };
  }

  /** Follow or unfollow a horse (not house horses; at most `limit` follows per player). */
  async setFollow(userId: string, horseId: string, on: boolean, limit = 100): Promise<void> {
    await this.db.tx(async (c) => {
      const h = await getHorse(c, horseId);
      if (!on) {
        await c.query("DELETE FROM horse_follows WHERE user_id = $1 AND horse_id = $2", [userId, horseId]);
        return;
      }
      if (h.is_house || h.retired_at)
        throw conflict("NOT_FOLLOWABLE", "Only active owned horses can be followed");
      // Serialise this player's follows so the limit holds under concurrent requests.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('follows:' || $1))", [userId]);
      const n = await rows<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM horse_follows WHERE user_id = $1",
        [userId],
      );
      if (n[0]!.n >= limit) throw conflict("FOLLOW_LIMIT", `You can follow up to ${limit} horses`);
      await c.query(
        "INSERT INTO horse_follows (user_id, horse_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [userId, horseId, this.clock.now()],
      );
    });
  }

  async ownerName(ownerId: string | null, c: Queryable = this.db.pool): Promise<string | null> {
    if (!ownerId) return null;
    const r = await rows<{ name: string }>(
      c,
      "SELECT COALESCE(username, first_name, 'Owner') AS name FROM users WHERE id = $1",
      [ownerId],
    );
    return r[0]?.name ?? null;
  }

  /** Lock a horse and verify the caller owns it. */
  async lockOwned(c: Queryable, horseId: string, userId: string): Promise<HorseRow> {
    const h = await getHorse(c, horseId, true);
    if (h.owner_id !== userId) throw h.is_house ? notFound("Horse") : forbidden("You do not own this horse");
    if (h.retired_at) throw conflict("HORSE_RETIRED", "This horse is retired");
    return h;
  }

  /** Pay the vet to heal an injury immediately. */
  async treat(userId: string, horseId: string): Promise<HorseRow> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      let h = await this.lockOwned(c, horseId, userId);
      h = await this.normalize(c, h, now);
      if (h.status !== "INJURED") throw conflict("NOT_INJURED", "This horse is not injured");
      const injury = await rows<{ id: string; severity: "MINOR" | "MODERATE" }>(
        c,
        "SELECT id, severity FROM injuries WHERE horse_id = $1 AND treated_at IS NULL AND heals_at > $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [horseId, now],
      );
      const severity = injury[0]?.severity ?? "MINOR";
      await this.ledger.debit(c, {
        userId,
        currency: "CREDITS",
        amount: this.config.get().economy.vetCost[severity],
        sink: "VET",
        key: `vet:${injury[0]?.id ?? horseId}`,
        type: "VET_TREATMENT",
        reason: `${severity} injury treatment`,
      });
      if (injury[0]) await c.query("UPDATE injuries SET treated_at = $2 WHERE id = $1", [injury[0].id, now]);
      const res = await c.query<HorseRow>(
        "UPDATE horses SET status = 'IDLE', injured_until = NULL, updated_at = $2 WHERE id = $1 RETURNING *",
        [horseId, now],
      );
      await this.events.emit(c, {
        type: "horse_treated",
        aggregateType: "horse",
        aggregateId: horseId,
        actorId: userId,
        payload: { severity },
      });
      return res.rows[0]!;
    });
  }

  /** Rename a horse for gems (sink RENAMES). Latin-only; unique among active horses. */
  async rename(userId: string, horseId: string, name: string): Promise<HorseRow> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const h = await this.lockOwned(c, horseId, userId);
      if (h.name === name) throw conflict("NAME_UNCHANGED", "That is already the horse's name");
      await c.query("SELECT pg_advisory_xact_lock(hashtext('horse-name:' || lower($1)))", [name]);
      const taken = await rows(
        c,
        "SELECT 1 FROM horses WHERE lower(name) = lower($1) AND id <> $2 AND retired_at IS NULL LIMIT 1",
        [name, h.id],
      );
      if (taken.length) throw conflict("NAME_TAKEN", "Another horse already has this name");
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: this.config.get().economy.renameHorseGems,
        sink: "RENAMES",
        key: `rename:horse:${h.id}:${now.getTime()}`,
        type: "RENAME",
        reason: `${h.name} renamed to ${name}`,
        metadata: { horseId: h.id, from: h.name, to: name },
      });
      const res = await c.query<HorseRow>(
        "UPDATE horses SET name = $2, updated_at = $3 WHERE id = $1 RETURNING *",
        [h.id, name, now],
      );
      await this.events.emit(c, {
        type: "horse_renamed",
        aggregateType: "horse",
        aggregateId: h.id,
        actorId: userId,
        payload: { from: h.name, to: name },
      });
      return res.rows[0]!;
    });
  }

  /** Paid veterinary diagnostics reveal the hidden genome (information economy, no power). */
  async diagnose(userId: string, horseId: string): Promise<HorseRow> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const h = await this.lockOwned(c, horseId, userId);
      if (h.diagnosed_at) return h;
      await this.ledger.debit(c, {
        userId,
        currency: "GEMS",
        amount: this.config.get().economy.diagnosticsCostGems,
        sink: "DIAGNOSTICS",
        key: `diagnostics:${horseId}`,
        type: "DIAGNOSTICS",
        reason: `Diagnostics for ${h.name}`,
      });
      const res = await c.query<HorseRow>(
        "UPDATE horses SET diagnosed_at = $2, updated_at = $2 WHERE id = $1 RETURNING *",
        [horseId, now],
      );
      return res.rows[0]!;
    });
  }
}
