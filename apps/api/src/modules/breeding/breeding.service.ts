import { Inject, Injectable } from "@nestjs/common";
import type { BreedingEventDto, BreedingPreviewDto, PedigreeNodeDto, StudDto } from "@thoroughline/contracts";
import {
  abilityRating,
  type Ancestry,
  birthDateForAge,
  breed,
  generateHorseName,
  inbreedingCoefficient,
  initialAttributes,
  potentialStars,
  Rng,
  TRAINABLE_ATTRIBUTES,
  type Attributes,
} from "@thoroughline/engine";
import { createHmac } from "node:crypto";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { ENV, type Env } from "../../config/env.js";
import { LedgerService } from "../economy/ledger.service.js";
import { getHorse, type HorseRow, insertHorse, recordOwnership } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { StableService } from "../stable/stable.service.js";

interface StudRow {
  horse_id: string;
  owner_id: string;
  fee: number;
  active: boolean;
}

interface EventRow {
  id: string;
  sire_id: string;
  dam_id: string;
  owner_id: string;
  sire_owner_id: string;
  stud_fee: number;
  breeding_fee: number;
  inbreeding: number;
  status: "PENDING" | "DELIVERED";
  covered_at: Date;
  due_at: Date;
  delivered_at: Date | null;
  foal_id: string | null;
}

const SIRES = new Set(["STALLION", "COLT"]);
const DAMS = new Set(["MARE", "FILLY"]);

/**
 * Breeding: a mare owner covers their mare with their own stallion or a stallion standing at
 * stud (fee to the stud owner, platform cut burned). The foal genome is drawn once, at
 * delivery, from a secret per-event seed, so it is reproducible and cannot be re-rolled.
 */
@Injectable()
export class BreedingService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly stables: StableService,
    private readonly events: EventsService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get cfg() {
    return this.config.get().breeding;
  }

  /** Parent links up to `depth` generations above the given horses. */
  async ancestry(c: Queryable, ids: string[], depth: number): Promise<Ancestry> {
    const list = await rows<{ id: string; sire_id: string | null; dam_id: string | null }>(
      c,
      `WITH RECURSIVE a(id, sire_id, dam_id, depth) AS (
         SELECT id, sire_id, dam_id, 0 FROM horses WHERE id = ANY($1::uuid[])
         UNION ALL
         SELECT h.id, h.sire_id, h.dam_id, a.depth + 1 FROM horses h JOIN a ON h.id IN (a.sire_id, a.dam_id)
          WHERE a.depth < $2)
       SELECT DISTINCT id, sire_id, dam_id FROM a`,
      [ids, depth],
    );
    return new Map(list.map((r) => [r.id, { sireId: r.sire_id, damId: r.dam_id }] as const));
  }

  private async activeStud(c: Queryable, horseId: string, lock = false): Promise<StudRow | null> {
    return row<StudRow>(c, `SELECT * FROM studs WHERE horse_id = $1 AND active${lock ? " FOR UPDATE" : ""}`, [
      horseId,
    ]);
  }

  /** All reasons the pair cannot be bred right now (empty ⇒ eligible). */
  private async reasons(
    c: Queryable,
    userId: string,
    sire: HorseRow,
    dam: HorseRow,
    stud: StudRow | null,
    now: Date,
  ): Promise<string[]> {
    const cfg = this.cfg;
    const out: string[] = [];
    if (sire.id === dam.id) return ["A horse cannot be bred with itself"];
    if (dam.owner_id !== userId) out.push("You can only breed your own mare");
    if (sire.owner_id !== userId && (!stud || stud.owner_id !== sire.owner_id))
      out.push("This stallion is not standing at stud");
    if (!SIRES.has(sire.sex)) out.push(`${sire.name} is not a stallion`);
    if (!DAMS.has(dam.sex)) out.push(`${dam.name} is not a mare`);
    for (const h of [sire, dam]) {
      if (this.horses.age(h, now) < cfg.minBreedingAge)
        out.push(`${h.name} is too young (minimum age ${cfg.minBreedingAge})`);
      if (this.horses.effectiveStatus(h, now) !== "IDLE")
        out.push(`${h.name} is ${this.horses.effectiveStatus(h, now).toLowerCase()}`);
    }
    const lastFoal = await row<{ delivered_at: Date }>(
      c,
      "SELECT delivered_at FROM breeding_events WHERE dam_id = $1 AND status = 'DELIVERED' ORDER BY delivered_at DESC LIMIT 1",
      [dam.id],
    );
    if (lastFoal && lastFoal.delivered_at.getTime() > now.getTime() - cfg.mareCooldownDays * 86_400_000) {
      out.push(`${dam.name} is resting after her last foal`);
    }
    const covers = await this.coversThisWeek(c, sire.id, now);
    if (covers >= cfg.sireCoversPerWeek) out.push(`${sire.name} has no covers left this week`);
    const stable = await this.stables.byOwner(c, userId);
    const owned = await row<{ n: number }>(
      c,
      "SELECT count(*)::int AS n FROM horses WHERE owner_id = $1 AND retired_at IS NULL",
      [userId],
    );
    const pending = await row<{ n: number }>(
      c,
      "SELECT count(*)::int AS n FROM breeding_events WHERE owner_id = $1 AND status = 'PENDING'",
      [userId],
    );
    if (owned!.n + pending!.n + 1 > this.stables.capacity(stable.level)) out.push("No free box for the foal");
    return out;
  }

  private async coversThisWeek(c: Queryable, sireId: string, now: Date): Promise<number> {
    const r = await row<{ n: number }>(
      c,
      "SELECT count(*)::int AS n FROM breeding_events WHERE sire_id = $1 AND covered_at > $2",
      [sireId, new Date(now.getTime() - 7 * 86_400_000)],
    );
    return r!.n;
  }

  private expectedStars(sire: HorseRow, dam: HorseRow, inbreeding: number): number {
    const b = this.cfg;
    const ceilings = {} as Attributes;
    for (const a of TRAINABLE_ATTRIBUTES) {
      ceilings[a] =
        b.heritability * ((sire.genome.ceilings[a] + dam.genome.ceilings[a]) / 2) +
        (1 - b.heritability) * b.populationMean -
        inbreeding * b.inbreedingCeilingPenalty;
    }
    return potentialStars({ ceilings });
  }

  private studFee(userId: string, sire: HorseRow, stud: StudRow | null): number {
    return sire.owner_id === userId || !stud ? 0 : stud.fee;
  }

  async preview(userId: string, sireId: string, damId: string): Promise<BreedingPreviewDto> {
    const now = this.clock.now();
    const c = this.db.pool;
    const [sire, dam] = [await getHorse(c, sireId), await getHorse(c, damId)];
    // Only the mare's owner may preview (the grade is derived from hidden genetics).
    if (dam.owner_id !== userId) throw forbidden("You can only plan breedings for your own mare");
    const stud = await this.activeStud(c, sireId);
    const reasons = await this.reasons(c, userId, sire, dam, stud, now);
    const inbreeding = inbreedingCoefficient(
      sire.id,
      dam.id,
      await this.ancestry(c, [sire.id, dam.id], 4),
      this.cfg.inbreedingGenerations,
    );
    const studFee = this.studFee(userId, sire, stud);
    return {
      eligible: reasons.length === 0,
      reasons,
      inbreeding: Math.round(inbreeding * 10_000) / 10_000,
      expectedStars: this.expectedStars(sire, dam, inbreeding),
      cost: { breedingFee: this.cfg.breedingFee, studFee, total: this.cfg.breedingFee + studFee },
      gestationHours: this.cfg.gestationHours,
    };
  }

  async cover(userId: string, sireId: string, damId: string): Promise<BreedingEventDto> {
    if (sireId === damId) throw badRequest("SAME_HORSE", "A horse cannot be bred with itself");
    const now = this.clock.now();
    const cfg = this.cfg;
    const id = await this.db.tx(async (c) => {
      // Lock both horses in id order (deadlock-free even if two owners breed the same pair).
      const [first, second] = [sireId, damId].sort();
      const locked = new Map<string, HorseRow>();
      for (const hid of [first!, second!])
        locked.set(hid, await this.horses.normalize(c, await getHorse(c, hid, true), now));
      const sire = locked.get(sireId)!;
      const dam = locked.get(damId)!;
      const stud = sire.owner_id === userId ? null : await this.activeStud(c, sireId, true);
      const reasons = await this.reasons(c, userId, sire, dam, stud, now);
      if (reasons.length) throw conflict("NOT_ELIGIBLE", reasons[0]!, { reasons });

      const inbreeding = inbreedingCoefficient(
        sire.id,
        dam.id,
        await this.ancestry(c, [sire.id, dam.id], 4),
        cfg.inbreedingGenerations,
      );
      const studFee = this.studFee(userId, sire, stud);
      const ev = await row<{ id: string }>(
        c,
        `INSERT INTO breeding_events (sire_id, dam_id, owner_id, sire_owner_id, stud_fee, breeding_fee, inbreeding, covered_at, due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          sire.id,
          dam.id,
          userId,
          sire.owner_id,
          studFee,
          cfg.breedingFee,
          inbreeding,
          now,
          new Date(now.getTime() + cfg.gestationHours * 3_600_000),
        ],
      );
      const cut = Math.floor(studFee * cfg.studFeeRate);
      await this.ledger.post(c, {
        idempotencyKey: `breeding:${ev!.id}`,
        type: "BREEDING",
        reason: `Covering ${dam.name} × ${sire.name}`,
        actorId: userId,
        metadata: { eventId: ev!.id, sireId: sire.id, damId: dam.id, studFee },
        entries: [
          { account: { user: userId, currency: "CREDITS" }, amount: -(cfg.breedingFee + studFee) },
          { account: { system: "BREEDING", currency: "CREDITS" }, amount: cfg.breedingFee },
          ...(studFee - cut > 0
            ? [{ account: { user: sire.owner_id!, currency: "CREDITS" as const }, amount: studFee - cut }]
            : []),
          ...(cut > 0
            ? [{ account: { system: "STUD_FEES" as const, currency: "CREDITS" as const }, amount: cut }]
            : []),
        ],
      });
      await c.query("UPDATE horses SET status = 'BREEDING', updated_at = $2 WHERE id = $1", [dam.id, now]);
      await this.events.emit(c, {
        type: "horse_covered",
        aggregateType: "breeding",
        aggregateId: ev!.id,
        actorId: userId,
        payload: { sireId: sire.id, damId: dam.id, studFee, sireOwner: sire.owner_id },
      });
      return ev!.id;
    });
    return (await this.mine(userId)).find((e) => e.id === id)!;
  }

  /** Deliver every foal whose gestation is over (idempotent, SKIP LOCKED). */
  async deliverDue(limit = 100): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM breeding_events WHERE status = 'PENDING' AND due_at <= $1 ORDER BY due_at LIMIT $2",
      [this.clock.now(), limit],
    );
    let n = 0;
    for (const d of due) if (await this.deliver(d.id)) n++;
    return n;
  }

  async deliver(eventId: string): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const ev = await row<EventRow>(
        c,
        "SELECT * FROM breeding_events WHERE id = $1 FOR UPDATE SKIP LOCKED",
        [eventId],
      );
      if (!ev || ev.status !== "PENDING" || ev.due_at > now) return false;
      const dam = await getHorse(c, ev.dam_id, true);
      const sire = await getHorse(c, ev.sire_id);
      const stable = await this.stables.byOwner(c, ev.owner_id);
      const seed = createHmac("sha256", this.env.RACE_SEED_SECRET).update(`breeding:${ev.id}`).digest("hex");
      const rng = new Rng(seed);
      const ancestry = await this.ancestry(c, [sire.id, dam.id], cfg.breeding.inbreedingGenerations);
      const out = breed(
        { id: sire.id, genome: sire.genome },
        { id: dam.id, genome: dam.genome },
        ancestry,
        rng,
        cfg,
      );
      const age = cfg.breeding.foalAgeAtDelivery;
      const attributes = initialAttributes(out.genome, age, rng);
      const foal = await insertHorse(c, {
        name: generateHorseName(rng),
        sex: rng.chance(0.5) ? "COLT" : "FILLY",
        birthAt: birthDateForAge(age, now, cfg),
        ownerId: ev.owner_id,
        stableId: stable.id,
        isHouse: false,
        genome: out.genome,
        attributes,
        abilityRating: abilityRating(attributes, out.genome.traits),
        raceRating: cfg.race.initialRating,
        now,
        sireId: sire.id,
        damId: dam.id,
        generation: Math.max(sire.generation, dam.generation) + 1,
        breederId: ev.owner_id,
      });
      await recordOwnership(c, foal.id, null, ev.owner_id, "BRED");
      await c.query(
        "UPDATE breeding_events SET status = 'DELIVERED', delivered_at = $2, foal_id = $3, mutation = $4 WHERE id = $1",
        [ev.id, now, foal.id, out.mutation ? JSON.stringify(out.mutation) : null],
      );
      await c.query(
        "UPDATE horses SET status = 'IDLE', updated_at = $2 WHERE id = $1 AND status = 'BREEDING'",
        [dam.id, now],
      );
      await this.events.emit(c, {
        type: "foal_delivered",
        aggregateType: "breeding",
        aggregateId: ev.id,
        actorId: ev.owner_id,
        payload: {
          userId: ev.owner_id,
          foalId: foal.id,
          foalName: foal.name,
          sireName: sire.name,
          damName: dam.name,
          rarity: foal.rarity,
          mutation: !!out.mutation,
        },
      });
      return true;
    });
  }

  /* ───────────────────────────── studs ───────────────────────────── */

  async offerStud(userId: string, horseId: string, fee: number): Promise<StudDto> {
    const now = this.clock.now();
    const cfg = this.cfg;
    if (fee > cfg.maxStudFee) throw badRequest("FEE_TOO_HIGH", `Stud fee is capped at ${cfg.maxStudFee}`);
    await this.db.tx(async (c) => {
      const h = await this.horses.lockOwned(c, horseId, userId);
      if (!SIRES.has(h.sex)) throw conflict("NOT_A_STALLION", `${h.name} cannot stand at stud`);
      if (this.horses.age(h, now) < cfg.minBreedingAge)
        throw conflict("TOO_YOUNG", `${h.name} is too young to stand at stud`);
      await c.query(
        `INSERT INTO studs (horse_id, owner_id, fee, active, updated_at) VALUES ($1,$2,$3,true,$4)
         ON CONFLICT (horse_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, fee = EXCLUDED.fee, active = true, updated_at = EXCLUDED.updated_at`,
        [horseId, userId, fee, now],
      );
    });
    return (await this.studs(userId)).find((s) => s.horse.id === horseId)!;
  }

  async withdrawStud(userId: string, horseId: string): Promise<void> {
    const r = await this.db.query(
      "UPDATE studs SET active = false, updated_at = now() WHERE horse_id = $1 AND owner_id = $2 AND active RETURNING horse_id",
      [horseId, userId],
    );
    if (r.length === 0) throw notFound("Stud offer");
  }

  async studs(viewerId: string): Promise<StudDto[]> {
    const now = this.clock.now();
    const list = await this.db.query<
      HorseRow & { fee: number; stud_owner: string; owner_name: string | null }
    >(
      `SELECT h.*, s.fee, s.owner_id AS stud_owner, COALESCE(u.username, u.first_name) AS owner_name
         FROM studs s JOIN horses h ON h.id = s.horse_id JOIN users u ON u.id = s.owner_id
        WHERE s.active AND h.owner_id = s.owner_id AND h.retired_at IS NULL
        ORDER BY s.fee, h.ability_rating DESC LIMIT 100`,
    );
    const out: StudDto[] = [];
    for (const h of list) {
      out.push({
        horse: this.horses.marketCard(h, now, h.fee, h.owner_name),
        fee: h.fee,
        ownerName: h.owner_name,
        mine: h.stud_owner === viewerId,
        coversThisWeek: await this.coversThisWeek(this.db.pool, h.id, now),
        coversPerWeek: this.cfg.sireCoversPerWeek,
      });
    }
    return out;
  }

  /* ───────────────────────────── queries ───────────────────────────── */

  async mine(userId: string): Promise<BreedingEventDto[]> {
    const list = await this.db.query<
      EventRow & { sire_name: string; dam_name: string; foal_name: string | null }
    >(
      `SELECT e.*, s.name AS sire_name, d.name AS dam_name, f.name AS foal_name
         FROM breeding_events e JOIN horses s ON s.id = e.sire_id JOIN horses d ON d.id = e.dam_id
         LEFT JOIN horses f ON f.id = e.foal_id
        WHERE e.owner_id = $1 ORDER BY e.covered_at DESC LIMIT 30`,
      [userId],
    );
    return list.map((e) => ({
      id: e.id,
      sire: { id: e.sire_id, name: e.sire_name },
      dam: { id: e.dam_id, name: e.dam_name },
      status: e.status,
      coveredAt: e.covered_at.toISOString(),
      dueAt: e.due_at.toISOString(),
      deliveredAt: e.delivered_at?.toISOString() ?? null,
      foal: e.foal_id ? { id: e.foal_id, name: e.foal_name! } : null,
      studFee: e.stud_fee,
      breedingFee: e.breeding_fee,
      inbreeding: e.inbreeding,
    }));
  }

  /** Pedigree tree (public information) up to `depth` generations. */
  async pedigree(horseId: string, depth = 3): Promise<PedigreeNodeDto> {
    const nodes = await this.db.query<HorseRow>(
      `WITH RECURSIVE a(id, sire_id, dam_id, depth) AS (
         SELECT id, sire_id, dam_id, 0 FROM horses WHERE id = $1
         UNION ALL
         SELECT h.id, h.sire_id, h.dam_id, a.depth + 1 FROM horses h JOIN a ON h.id IN (a.sire_id, a.dam_id)
          WHERE a.depth < $2)
       SELECT * FROM horses WHERE id IN (SELECT id FROM a)`,
      [horseId, depth],
    );
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    if (!byId.has(horseId)) throw notFound("Horse");
    const build = (id: string | null, d: number): PedigreeNodeDto | null => {
      const h = id ? byId.get(id) : undefined;
      if (!h) return null;
      return {
        id: h.id,
        name: h.name,
        sex: h.sex,
        rarity: h.rarity,
        bloodline: h.bloodline,
        starts: h.starts,
        wins: h.wins,
        sire: d < depth ? build(h.sire_id, d + 1) : null,
        dam: d < depth ? build(h.dam_id, d + 1) : null,
      };
    };
    return build(horseId, 0)!;
  }
}
