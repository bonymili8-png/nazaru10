import { Injectable } from "@nestjs/common";
import type {
  ConditionDto,
  HorseDetailDto,
  HorseSummaryDto,
  ShopHorseDto,
  TrainingSessionDto,
} from "@thoroughline/contracts";
import {
  ageInYears,
  type Condition,
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
        hoursUntilFatigue(cond.fatigue, cfg.condition.maxFatigueToRace, h.attributes.endurance, cfg),
        2,
      ),
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
  ): HorseDetailDto {
    const isOwner = viewerId !== null && h.owner_id === viewerId;
    return {
      ...this.summary(h, now, ownerName),
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
