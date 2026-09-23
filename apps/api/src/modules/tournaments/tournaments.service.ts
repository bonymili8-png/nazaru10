import { Injectable } from "@nestjs/common";
import type { TournamentDetailDto, TournamentDto, TournamentEntryDto } from "@thoroughline/contracts";
import {
  assertTransition,
  canRaceAtAge,
  type RaceClass,
  Rng,
  seasonAt,
  type Strategy,
  TOURNAMENT_TIERS,
  type TournamentTier,
  TRACKS,
  trackByCode,
} from "@thoroughline/engine";
import type { PoolClient } from "pg";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import type { HorseRow } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { RaceRunnerService } from "../races/race-runner.service.js";
import { TrainingService } from "../training/training.service.js";

const HOUR = 3_600_000;
const MINUTE = 60_000;

const TIER_LABEL: Record<TournamentTier, string> = {
  LOCAL: "Local Cup",
  REGIONAL: "Regional Cup",
  NATIONAL: "National Championship",
  ELITE: "Elite Invitational",
};

interface TournamentRow {
  id: string;
  name: string;
  tier: TournamentTier;
  status: TournamentDto["status"];
  race_class: RaceClass;
  track_code: string;
  distance: number;
  entry_fee: number;
  purse: number;
  min_season_points: number | null;
  min_rating: number | null;
  max_entrants: number;
  players_per_heat: number;
  qualifiers_per_heat: number;
  opens_at: Date;
  registration_closes_at: Date;
  heats_at: Date;
  final_at: Date;
  final_race_id: string | null;
  winner_horse_id: string | null;
  winner_owner_id: string | null;
  completed_at: Date | null;
}

interface EntryRow {
  tournament_id: string;
  horse_id: string;
  owner_id: string;
  strategy: Strategy;
  status: TournamentEntryDto["status"];
  heat_race_id: string | null;
  heat_position: number | null;
  final_position: number | null;
  entry_fee: number;
  registrations: number;
}

/**
 * Tournaments: registration (fee, qualification) → heats (ordinary races, seeded by rating)
 * → final (ordinary race carrying the tournament purse) → champion. Heats and the final reuse
 * the race lifecycle (lock/run/settle); this service only moves the bracket forward. Every
 * step is one transaction guarded by a status check and a row lock, so steps are idempotent.
 */
@Injectable()
export class TournamentsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly training: TrainingService,
    private readonly runner: RaceRunnerService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  /* ───────────────────────────── scheduling ───────────────────────────── */

  /** Create every tournament whose registration opens within the next hour (idempotent per tier slot). */
  async scheduleAhead(): Promise<number> {
    const now = this.clock.now().getTime();
    const tc = this.config.get().tournaments;
    let created = 0;
    for (const tier of TOURNAMENT_TIERS) {
      const t = tc.tiers[tier];
      const step = t.everyHours * HOUR;
      const offset = t.offsetHours * HOUR;
      const earliest = now + tc.registrationCloseMinutes * MINUTE + MINUTE;
      const horizon = now + tc.registrationOpenHours * HOUR + HOUR;
      for (let at = Math.ceil((earliest - offset) / step) * step + offset; at <= horizon; at += step) {
        const heatsAt = new Date(at);
        const rng = new Rng(`tournament:${tier}:${heatsAt.toISOString()}`);
        const track = rng.pick(TRACKS);
        const distance = rng.pick(track.distances);
        const res = await this.db.query<{ id: string }>(
          `INSERT INTO tournaments (name, tier, race_class, track_code, distance, entry_fee, purse, min_season_points,
                                    min_rating, max_entrants, players_per_heat, qualifiers_per_heat, opens_at,
                                    registration_closes_at, heats_at, final_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT DO NOTHING RETURNING id`,
          [
            `${track.name} ${TIER_LABEL[tier]}`,
            tier,
            t.raceClass,
            track.code,
            distance,
            t.entryFee,
            t.purse,
            t.minSeasonPoints,
            t.minRating,
            t.maxEntrants,
            t.playersPerHeat,
            t.qualifiersPerHeat,
            new Date(at - tc.registrationOpenHours * HOUR),
            new Date(at - tc.registrationCloseMinutes * MINUTE),
            heatsAt,
            new Date(at + tc.finalAfterMinutes * MINUTE),
          ],
        );
        created += res.length;
      }
    }
    return created;
  }

  /* ───────────────────────────── registration ───────────────────────────── */

  private async lockTournament(c: Queryable, id: string): Promise<TournamentRow> {
    const t = await row<TournamentRow>(c, "SELECT * FROM tournaments WHERE id = $1 FOR UPDATE", [id]);
    if (!t) throw notFound("Tournament");
    return t;
  }

  private assertRegistrationOpen(t: TournamentRow, now: Date): void {
    if (t.status !== "REGISTRATION" || now < t.opens_at || now >= t.registration_closes_at)
      throw conflict("REGISTRATION_CLOSED", "Registration for this tournament is closed");
  }

  async register(
    userId: string,
    id: string,
    horseId: string,
    strategy: Strategy,
  ): Promise<TournamentDetailDto> {
    await this.training.settleDueForOwner(userId);
    const now = this.clock.now();
    const cfg = this.config.get();
    await this.db.tx(async (c) => {
      // Lock order: tournament, then horse (same as races → no deadlocks).
      const t = await this.lockTournament(c, id);
      this.assertRegistrationOpen(t, now);
      const counts = await row<{ total: number; mine: number }>(
        c,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE owner_id = $2)::int AS mine
           FROM tournament_entries WHERE tournament_id = $1 AND status = 'REGISTERED'`,
        [id, userId],
      );
      if (counts!.total >= t.max_entrants) throw conflict("TOURNAMENT_FULL", "This tournament is full");
      if (counts!.mine >= cfg.tournaments.maxHorsesPerOwner)
        throw conflict(
          "OWNER_LIMIT",
          `You can enter at most ${cfg.tournaments.maxHorsesPerOwner} horses in one tournament`,
        );

      let h = await this.horses.lockOwned(c, horseId, userId);
      h = await this.horses.normalize(c, h, now);
      if (h.status !== "IDLE") throw conflict("HORSE_BUSY", `Horse is ${h.status.toLowerCase()}`);
      assertTransition(h.status, "ENTERED");
      if (!canRaceAtAge(this.horses.age(h, t.heats_at), cfg))
        throw conflict("AGE_INELIGIBLE", "Horse is not of racing age");
      const cond = this.horses.condition(h, t.heats_at);
      if (cond.health < cfg.condition.minHealthToRace)
        throw conflict("HEALTH_TOO_LOW", "Horse is not healthy enough to race");
      if (cond.fatigue > cfg.condition.maxFatigueToRace)
        throw conflict("TOO_FATIGUED", "Horse will still be too tired when the heats start");
      await this.assertQualified(c, t, h, userId, now);

      const prev = await row<EntryRow>(
        c,
        "SELECT * FROM tournament_entries WHERE tournament_id = $1 AND horse_id = $2 FOR UPDATE",
        [id, horseId],
      );
      if (prev && prev.status !== "WITHDRAWN")
        throw conflict("ALREADY_REGISTERED", "This horse is already registered");
      const n = prev ? prev.registrations + 1 : 1;
      if (prev) {
        await c.query(
          `UPDATE tournament_entries SET status = 'REGISTERED', owner_id = $3, strategy = $4, entry_fee = $5,
                  registrations = $6 WHERE tournament_id = $1 AND horse_id = $2`,
          [id, horseId, userId, strategy, t.entry_fee, n],
        );
      } else {
        await c.query(
          `INSERT INTO tournament_entries (tournament_id, horse_id, owner_id, strategy, entry_fee)
           VALUES ($1,$2,$3,$4,$5)`,
          [id, horseId, userId, strategy, t.entry_fee],
        );
      }
      if (t.entry_fee > 0) {
        await this.ledger.debit(c, {
          userId,
          currency: "CREDITS",
          amount: t.entry_fee,
          sink: "TOURNAMENT_FEES",
          key: `tournament:${id}:entry:${horseId}:${n}`,
          type: "TOURNAMENT_ENTRY",
          reason: `Entry — ${t.name}`,
          metadata: { tournamentId: id, horseId },
        });
      }
      // The horse is committed to the tournament: no training or other races until it is decided.
      await c.query("UPDATE horses SET status = 'ENTERED', updated_at = $2 WHERE id = $1", [horseId, now]);
      await this.events.emit(c, {
        type: "tournament_registered",
        aggregateType: "tournament",
        aggregateId: id,
        actorId: userId,
        payload: { horseId, strategy },
      });
    });
    return this.detail(id, userId);
  }

  /** Qualification: current-season owner points OR the horse's race rating; open when neither is set. */
  private async assertQualified(
    c: Queryable,
    t: TournamentRow,
    h: HorseRow,
    userId: string,
    now: Date,
  ): Promise<void> {
    if (t.min_season_points === null && t.min_rating === null) return;
    if (t.min_rating !== null && h.race_rating >= t.min_rating) return;
    if (t.min_season_points !== null) {
      const { season } = seasonAt(now, this.config.get());
      const p = await row<{ points: number }>(
        c,
        "SELECT COALESCE(sum(points),0)::int AS points FROM season_points WHERE season = $1 AND owner_id = $2",
        [season, userId],
      );
      if (p!.points >= t.min_season_points) return;
    }
    const need = [
      t.min_season_points !== null ? `${t.min_season_points} season points` : null,
      t.min_rating !== null ? `a race rating of ${t.min_rating}+` : null,
    ]
      .filter(Boolean)
      .join(" or ");
    throw conflict("NOT_QUALIFIED", `Qualification requires ${need}`);
  }

  async withdraw(userId: string, id: string, horseId: string): Promise<TournamentDetailDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const t = await this.lockTournament(c, id);
      this.assertRegistrationOpen(t, now);
      const e = await row<EntryRow>(
        c,
        `SELECT * FROM tournament_entries WHERE tournament_id = $1 AND horse_id = $2 AND owner_id = $3
            AND status = 'REGISTERED' FOR UPDATE`,
        [id, horseId, userId],
      );
      if (!e) throw notFound("Entry");
      await this.horses.lockOwned(c, horseId, userId);
      await c.query(
        "UPDATE tournament_entries SET status = 'WITHDRAWN' WHERE tournament_id = $1 AND horse_id = $2",
        [id, horseId],
      );
      await this.refund(c, t, e, "Withdrawn");
      await c.query(
        "UPDATE horses SET status = 'IDLE', updated_at = $2 WHERE id = $1 AND status = 'ENTERED'",
        [horseId, now],
      );
      await this.events.emit(c, {
        type: "tournament_withdrawn",
        aggregateType: "tournament",
        aggregateId: id,
        actorId: userId,
        payload: { horseId },
      });
    });
    return this.detail(id, userId);
  }

  private async refund(c: Queryable, t: TournamentRow, e: EntryRow, why: string): Promise<void> {
    if (e.entry_fee <= 0) return;
    await this.ledger.credit(c, {
      userId: e.owner_id,
      currency: "CREDITS",
      amount: e.entry_fee,
      source: "TOURNAMENT_REFUND",
      key: `tournament:${t.id}:refund:${e.horse_id}:${e.registrations}`,
      type: "TOURNAMENT_REFUND",
      reason: `${why} — ${t.name}`,
      metadata: { tournamentId: t.id, horseId: e.horse_id },
    });
  }

  /* ───────────────────────────── bracket ───────────────────────────── */

  /** Advance every tournament that has a due step. Returns the number of transitions. */
  async advanceDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.db.query<{ id: string }>(
      `SELECT id FROM tournaments
        WHERE (status = 'REGISTRATION' AND registration_closes_at <= $1) OR status IN ('HEATS','FINAL')
        ORDER BY heats_at LIMIT 50`,
      [now],
    );
    let n = 0;
    for (const t of due) if (await this.advance(t.id)) n++;
    return n;
  }

  async advance(id: string): Promise<boolean> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const t = await row<TournamentRow>(
        c,
        "SELECT * FROM tournaments WHERE id = $1 FOR UPDATE SKIP LOCKED",
        [id],
      );
      if (!t) return false;
      if (t.status === "REGISTRATION" && t.registration_closes_at <= now) return this.draw(c, t, now);
      if (t.status === "HEATS") return this.toFinal(c, t, now);
      if (t.status === "FINAL") return this.complete(c, t, now);
      return false;
    });
  }

  /** Registration closed: seed the field into heats (snake by rating) or go straight to the final. */
  private async draw(c: PoolClient, t: TournamentRow, now: Date): Promise<boolean> {
    const cfg = this.config.get();
    const entries = await rows<EntryRow & { race_rating: number }>(
      c,
      `SELECT e.*, h.race_rating FROM tournament_entries e JOIN horses h ON h.id = e.horse_id
        WHERE e.tournament_id = $1 AND e.status = 'REGISTERED' ORDER BY h.race_rating DESC, e.horse_id`,
      [t.id],
    );
    if (entries.length < 2) {
      await this.cancelInTx(c, t, "Not enough entrants", now);
      return true;
    }
    if (entries.length <= t.players_per_heat) {
      await this.createFinal(c, t, entries, t.heats_at, now);
      return true;
    }
    const heats = Math.ceil(entries.length / t.players_per_heat);
    const buckets: (typeof entries)[] = Array.from({ length: heats }, () => []);
    entries.forEach((e, i) => {
      const pass = Math.floor(i / heats);
      buckets[pass % 2 === 0 ? i % heats : heats - 1 - (i % heats)]!.push(e);
    });
    for (const [k, bucket] of buckets.entries()) {
      const raceId = await this.runner.insertRace({
        c,
        cls: t.race_class,
        trackCode: t.track_code,
        distance: t.distance,
        startsAt: new Date(t.heats_at.getTime() + k * cfg.tournaments.heatSpacingMinutes * MINUTE),
        rng: new Rng(`tournament:${t.id}:heat:${k}`),
        special: true,
        name: `${t.name} — Heat ${k + 1}`,
        purse: 0,
        entryFee: 0,
        tournament: { id: t.id, stage: "HEAT" },
      });
      for (const e of bucket) {
        await c.query(
          "INSERT INTO race_entries (race_id, horse_id, owner_id, strategy, entry_fee) VALUES ($1,$2,$3,$4,0)",
          [raceId, e.horse_id, e.owner_id, e.strategy],
        );
        await c.query(
          "UPDATE tournament_entries SET status = 'IN_HEAT', heat_race_id = $3 WHERE tournament_id = $1 AND horse_id = $2",
          [t.id, e.horse_id, raceId],
        );
      }
    }
    await c.query("UPDATE tournaments SET status = 'HEATS' WHERE id = $1", [t.id]);
    await this.events.emit(c, {
      type: "tournament_drawn",
      aggregateType: "tournament",
      aggregateId: t.id,
      payload: { entrants: entries.length, heats },
    });
    return true;
  }

  /** All heats decided: the best player finishers of each heat go through to the final. */
  private async toFinal(c: PoolClient, t: TournamentRow, now: Date): Promise<boolean> {
    const heats = await rows<{ id: string; status: string }>(
      c,
      "SELECT id, status FROM races WHERE tournament_id = $1 AND stage = 'HEAT' ORDER BY starts_at",
      [t.id],
    );
    if (heats.some((h) => h.status !== "COMPLETED" && h.status !== "CANCELLED")) return false;
    const finalists: EntryRow[] = [];
    for (const heat of heats) {
      const entries = await rows<EntryRow>(
        c,
        "SELECT * FROM tournament_entries WHERE tournament_id = $1 AND heat_race_id = $2 AND status = 'IN_HEAT'",
        [t.id, heat.id],
      );
      if (heat.status === "CANCELLED") {
        // A heat that never ran is not the entrants' fault: scratch and refund.
        for (const e of entries) {
          await this.setEntry(c, t.id, e.horse_id, "SCRATCHED");
          await this.refund(c, t, e, "Heat cancelled");
        }
        continue;
      }
      const results = await rows<{ horse_id: string; position: number }>(
        c,
        `SELECT horse_id, position FROM race_entries
          WHERE race_id = $1 AND status = 'RAN' AND NOT is_house ORDER BY position`,
        [heat.id],
      );
      const pos = new Map(results.map((r) => [r.horse_id, r.position] as const));
      const order = [...entries].sort(
        (a, b) =>
          (pos.get(a.horse_id) ?? 99) - (pos.get(b.horse_id) ?? 99) || a.horse_id.localeCompare(b.horse_id),
      );
      for (const [i, e] of order.entries()) {
        await c.query(
          "UPDATE tournament_entries SET heat_position = $3 WHERE tournament_id = $1 AND horse_id = $2",
          [t.id, e.horse_id, pos.get(e.horse_id) ?? null],
        );
        if (i < t.qualifiers_per_heat && pos.has(e.horse_id)) finalists.push(e);
        else await this.setEntry(c, t.id, e.horse_id, "ELIMINATED");
      }
    }
    // A finalist must still be fit, idle and with the same owner (it may have been injured in its heat).
    const fit: EntryRow[] = [];
    for (const e of finalists) {
      const h = await row<HorseRow>(c, "SELECT * FROM horses WHERE id = $1 FOR UPDATE", [e.horse_id]);
      const ok =
        !!h &&
        h.owner_id === e.owner_id &&
        !h.retired_at &&
        this.horses.effectiveStatus(h, now) === "IDLE" &&
        this.horses.condition(h, t.final_at).health >= this.config.get().condition.minHealthToRace;
      if (ok) fit.push(e);
      else await this.setEntry(c, t.id, e.horse_id, "SCRATCHED");
    }
    if (fit.length === 0) {
      await c.query("UPDATE tournaments SET status = 'CANCELLED', completed_at = $2 WHERE id = $1", [
        t.id,
        now,
      ]);
      await this.emitClosed(c, t, "No eligible finalists");
      return true;
    }
    await this.createFinal(c, t, fit, t.final_at, now);
    return true;
  }

  private async createFinal(
    c: PoolClient,
    t: TournamentRow,
    entries: EntryRow[],
    startsAt: Date,
    now: Date,
  ): Promise<void> {
    const raceId = await this.runner.insertRace({
      c,
      cls: t.race_class,
      trackCode: t.track_code,
      distance: t.distance,
      startsAt,
      rng: new Rng(`tournament:${t.id}:final`),
      special: true,
      name: `${t.name} — Final`,
      purse: t.purse,
      entryFee: 0,
      tournament: { id: t.id, stage: "FINAL" },
    });
    for (const e of entries) {
      await c.query(
        "INSERT INTO race_entries (race_id, horse_id, owner_id, strategy, entry_fee) VALUES ($1,$2,$3,$4,0)",
        [raceId, e.horse_id, e.owner_id, e.strategy],
      );
      await this.setEntry(c, t.id, e.horse_id, "FINALIST");
      await c.query("UPDATE horses SET status = 'ENTERED', updated_at = $2 WHERE id = $1", [e.horse_id, now]);
    }
    await c.query("UPDATE tournaments SET status = 'FINAL', final_race_id = $2 WHERE id = $1", [
      t.id,
      raceId,
    ]);
    await this.events.emit(c, {
      type: "tournament_final_drawn",
      aggregateType: "tournament",
      aggregateId: t.id,
      payload: { finalists: entries.length, raceId },
    });
  }

  /** Final settled: record placings, crown the best player finisher (the purse was paid by the race). */
  private async complete(c: PoolClient, t: TournamentRow, now: Date): Promise<boolean> {
    const final = await row<{ status: string }>(c, "SELECT status FROM races WHERE id = $1", [
      t.final_race_id,
    ]);
    if (!final || (final.status !== "COMPLETED" && final.status !== "CANCELLED")) return false;
    if (final.status === "CANCELLED") {
      const entries = await rows<EntryRow>(
        c,
        "SELECT * FROM tournament_entries WHERE tournament_id = $1 AND status = 'FINALIST'",
        [t.id],
      );
      for (const e of entries) {
        await this.setEntry(c, t.id, e.horse_id, "SCRATCHED");
        await this.refund(c, t, e, "Final cancelled");
      }
      await c.query("UPDATE tournaments SET status = 'CANCELLED', completed_at = $2 WHERE id = $1", [
        t.id,
        now,
      ]);
      await this.emitClosed(c, t, "Final cancelled");
      return true;
    }
    const results = await rows<{ horse_id: string; owner_id: string; position: number; name: string }>(
      c,
      `SELECT e.horse_id, e.owner_id, e.position, h.name FROM race_entries e JOIN horses h ON h.id = e.horse_id
        WHERE e.race_id = $1 AND e.status = 'RAN' AND NOT e.is_house ORDER BY e.position`,
      [t.final_race_id],
    );
    for (const r of results) {
      await c.query(
        "UPDATE tournament_entries SET final_position = $3 WHERE tournament_id = $1 AND horse_id = $2",
        [t.id, r.horse_id, r.position],
      );
    }
    const champ = results[0] ?? null;
    if (champ) {
      const tier = this.config.get().tournaments.tiers[t.tier];
      for (const [currency, amount] of [
        ["PRESTIGE", tier.championPrestige],
        ["REPUTATION", tier.championReputation],
      ] as const) {
        if (amount <= 0) continue;
        await this.ledger.credit(c, {
          userId: champ.owner_id,
          currency,
          amount,
          source: "TOURNAMENT_PRIZE",
          key: `tournament:${t.id}:champion:${currency}`,
          type: "TOURNAMENT_CHAMPION",
          reason: `Champion — ${t.name}`,
          metadata: { tournamentId: t.id, horseId: champ.horse_id },
        });
      }
      await this.events.emit(c, {
        type: "tournament_champion",
        aggregateType: "tournament",
        aggregateId: t.id,
        actorId: champ.owner_id,
        payload: { userId: champ.owner_id, horseName: champ.name, tournamentName: t.name, tier: t.tier },
      });
    }
    await c.query(
      `UPDATE tournaments SET status = 'COMPLETED', completed_at = $2, winner_horse_id = $3, winner_owner_id = $4
        WHERE id = $1`,
      [t.id, now, champ?.horse_id ?? null, champ?.owner_id ?? null],
    );
    await this.emitClosed(c, t, null);
    return true;
  }

  private async cancelInTx(c: PoolClient, t: TournamentRow, reason: string, now: Date): Promise<void> {
    const entries = await rows<EntryRow>(
      c,
      "SELECT * FROM tournament_entries WHERE tournament_id = $1 AND status = 'REGISTERED' FOR UPDATE",
      [t.id],
    );
    for (const e of entries) {
      await this.setEntry(c, t.id, e.horse_id, "SCRATCHED");
      await this.refund(c, t, e, reason);
      await c.query(
        "UPDATE horses SET status = 'IDLE', updated_at = $2 WHERE id = $1 AND status = 'ENTERED'",
        [e.horse_id, now],
      );
    }
    await c.query("UPDATE tournaments SET status = 'CANCELLED', completed_at = $2 WHERE id = $1", [
      t.id,
      now,
    ]);
    await this.emitClosed(c, t, reason);
  }

  private setEntry(c: Queryable, id: string, horseId: string, status: EntryRow["status"]) {
    return c.query("UPDATE tournament_entries SET status = $3 WHERE tournament_id = $1 AND horse_id = $2", [
      id,
      horseId,
      status,
    ]);
  }

  private emitClosed(c: Queryable, t: TournamentRow, reason: string | null) {
    return this.events.emit(c, {
      type: reason ? "tournament_cancelled" : "tournament_completed",
      aggregateType: "tournament",
      aggregateId: t.id,
      payload: { reason },
    });
  }

  /* ───────────────────────────── views ───────────────────────────── */

  private async entryViews(ids: string[], viewerId: string, onlyMine: boolean) {
    const list = await this.db.query<EntryRow & { horse_name: string; owner_name: string | null }>(
      `SELECT e.*, h.name AS horse_name, COALESCE(u.username, u.first_name) AS owner_name
         FROM tournament_entries e JOIN horses h ON h.id = e.horse_id JOIN users u ON u.id = e.owner_id
        WHERE e.tournament_id = ANY($1::uuid[]) AND e.status <> 'WITHDRAWN' AND ($2::uuid IS NULL OR e.owner_id = $2)
        ORDER BY e.final_position NULLS LAST, e.heat_position NULLS LAST, e.created_at`,
      [ids, onlyMine ? viewerId : null],
    );
    const out = new Map<string, TournamentEntryDto[]>();
    for (const e of list) {
      const dto: TournamentEntryDto = {
        horseId: e.horse_id,
        horseName: e.horse_name,
        ownerName: e.owner_name,
        status: e.status,
        heatRaceId: e.heat_race_id,
        heatPosition: e.heat_position,
        finalPosition: e.final_position,
        mine: e.owner_id === viewerId,
      };
      out.set(e.tournament_id, [...(out.get(e.tournament_id) ?? []), dto]);
    }
    return out;
  }

  private async toDtos(list: TournamentRow[], viewerId: string): Promise<TournamentDto[]> {
    if (list.length === 0) return [];
    const ids = list.map((t) => t.id);
    const counts = new Map(
      (
        await this.db.query<{ tournament_id: string; n: number }>(
          `SELECT tournament_id, count(*)::int AS n FROM tournament_entries
            WHERE tournament_id = ANY($1::uuid[]) AND status NOT IN ('WITHDRAWN') GROUP BY tournament_id`,
          [ids],
        )
      ).map((r) => [r.tournament_id, r.n] as const),
    );
    const heats = await this.db.query<{ tournament_id: string; id: string }>(
      "SELECT tournament_id, id FROM races WHERE tournament_id = ANY($1::uuid[]) AND stage = 'HEAT' ORDER BY starts_at",
      [ids],
    );
    const winners = new Map(
      (
        await this.db.query<{ id: string; horse_name: string; owner_name: string | null }>(
          `SELECT t.id, h.name AS horse_name, COALESCE(u.username, u.first_name) AS owner_name
             FROM tournaments t JOIN horses h ON h.id = t.winner_horse_id LEFT JOIN users u ON u.id = t.winner_owner_id
            WHERE t.id = ANY($1::uuid[])`,
          [ids],
        )
      ).map((r) => [r.id, r] as const),
    );
    const mine = await this.entryViews(ids, viewerId, true);
    return list.map((t) => {
      const w = winners.get(t.id);
      return {
        id: t.id,
        name: t.name,
        tier: t.tier,
        status: t.status,
        raceClass: t.race_class,
        trackCode: t.track_code,
        trackName: trackByCode(t.track_code).name,
        distance: t.distance,
        entryFee: t.entry_fee,
        purse: t.purse,
        qualification: { minSeasonPoints: t.min_season_points, minRating: t.min_rating },
        opensAt: t.opens_at.toISOString(),
        registrationClosesAt: t.registration_closes_at.toISOString(),
        heatsAt: t.heats_at.toISOString(),
        finalAt: t.final_at.toISOString(),
        entrants: counts.get(t.id) ?? 0,
        maxEntrants: t.max_entrants,
        heatRaceIds: heats.filter((h) => h.tournament_id === t.id).map((h) => h.id),
        finalRaceId: t.final_race_id,
        winner:
          w && t.winner_horse_id
            ? { horseId: t.winner_horse_id, horseName: w.horse_name, ownerName: w.owner_name }
            : null,
        myEntries: mine.get(t.id) ?? [],
      };
    });
  }

  /** Upcoming and running tournaments first, then the most recent finished ones. */
  async list(viewerId: string): Promise<TournamentDto[]> {
    const now = this.clock.now();
    const active = await this.db.query<TournamentRow>(
      `SELECT * FROM tournaments WHERE status IN ('REGISTRATION','HEATS','FINAL') AND opens_at <= $1
        ORDER BY heats_at LIMIT 20`,
      [now],
    );
    const done = await this.db.query<TournamentRow>(
      "SELECT * FROM tournaments WHERE status IN ('COMPLETED','CANCELLED') ORDER BY heats_at DESC LIMIT 10",
    );
    return this.toDtos([...active, ...done], viewerId);
  }

  async detail(id: string, viewerId: string): Promise<TournamentDetailDto> {
    const t = await this.db.one<TournamentRow>("SELECT * FROM tournaments WHERE id = $1", [id]);
    if (!t) throw notFound("Tournament");
    const [dto] = await this.toDtos([t], viewerId);
    const entries = await this.entryViews([id], viewerId, false);
    return { ...dto!, entries: entries.get(id) ?? [] };
  }
}
