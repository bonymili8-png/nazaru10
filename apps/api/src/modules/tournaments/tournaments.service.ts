import { Injectable } from "@nestjs/common";
import type {
  TournamentDetailDto,
  TournamentDto,
  TournamentEntryDto,
  TournamentHistoryQuery,
  TournamentRoundDto,
  TournamentRunnerDto,
  TournamentStandingDto,
} from "@thoroughline/contracts";
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
  cancel_reason: string | null;
  house_fill: boolean;
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
    const entries = await rows<EntryRow & { race_rating: number; horse_name: string }>(
      c,
      `SELECT e.*, h.race_rating, h.name AS horse_name FROM tournament_entries e JOIN horses h ON h.id = e.horse_id
        WHERE e.tournament_id = $1 AND e.status = 'REGISTERED' ORDER BY h.race_rating DESC, e.horse_id`,
      [t.id],
    );
    // House fill (admin switch, fixed here for the whole cup): one entrant is enough.
    const fill = cfg.tournaments.houseFill.enabled;
    if (entries.length < (fill ? 1 : 2)) {
      await this.cancelInTx(c, t, "Not enough entrants", now);
      return true;
    }
    if (fill) {
      await c.query("UPDATE tournaments SET house_fill = true WHERE id = $1", [t.id]);
      t.house_fill = true;
    }
    if (entries.length <= t.players_per_heat) {
      await this.createFinal(c, t, entries, t.heats_at, now);
      await this.notifyOwners(
        c,
        t,
        "tournament_draw",
        group(entries, (e) => ({ horseName: e.horse_name, heat: 0, startsAt: t.heats_at.toISOString() })),
        { heats: 0, entrants: entries.length },
      );
      return true;
    }
    const heats = Math.ceil(entries.length / t.players_per_heat);
    const buckets: (typeof entries)[] = Array.from({ length: heats }, () => []);
    entries.forEach((e, i) => {
      const pass = Math.floor(i / heats);
      buckets[pass % 2 === 0 ? i % heats : heats - 1 - (i % heats)]!.push(e);
    });
    const drawn: { e: (typeof entries)[number]; heat: number; startsAt: Date }[] = [];
    for (const [k, bucket] of buckets.entries()) {
      const startsAt = new Date(t.heats_at.getTime() + k * cfg.tournaments.heatSpacingMinutes * MINUTE);
      const raceId = await this.runner.insertRace({
        c,
        cls: t.race_class,
        trackCode: t.track_code,
        distance: t.distance,
        startsAt,
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
        drawn.push({ e, heat: k + 1, startsAt });
      }
    }
    await c.query("UPDATE tournaments SET status = 'HEATS' WHERE id = $1", [t.id]);
    await this.events.emit(c, {
      type: "tournament_drawn",
      aggregateType: "tournament",
      aggregateId: t.id,
      payload: { entrants: entries.length, heats },
    });
    await this.notifyOwners(
      c,
      t,
      "tournament_draw",
      group(
        drawn.map((d) => ({ ...d.e, heat: d.heat, startsAt: d.startsAt })),
        (d) => ({ horseName: d.horse_name, heat: d.heat, startsAt: d.startsAt.toISOString() }),
      ),
      { heats, entrants: entries.length, qualifiersPerHeat: t.qualifiers_per_heat },
    );
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
    // What each owner hears: every horse's heat, placing and whether it goes on.
    const outcome = new Map<
      string,
      { e: EntryRow & { horse_name: string }; heat: number; position: number | null; result: string }
    >();
    for (const [k, heat] of heats.entries()) {
      const entries = await rows<EntryRow & { horse_name: string }>(
        c,
        `SELECT e.*, h.name AS horse_name FROM tournament_entries e JOIN horses h ON h.id = e.horse_id
          WHERE e.tournament_id = $1 AND e.heat_race_id = $2 AND e.status = 'IN_HEAT'`,
        [t.id, heat.id],
      );
      if (heat.status === "CANCELLED") {
        // A heat that never ran is not the entrants' fault: scratch and refund.
        for (const e of entries) {
          await this.setEntry(c, t.id, e.horse_id, "SCRATCHED");
          await this.refund(c, t, e, "Heat cancelled");
          outcome.set(e.horse_id, { e, heat: k + 1, position: null, result: "REFUNDED" });
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
        const through = i < t.qualifiers_per_heat && pos.has(e.horse_id);
        if (through) finalists.push(e);
        else await this.setEntry(c, t.id, e.horse_id, "ELIMINATED");
        outcome.set(e.horse_id, {
          e,
          heat: k + 1,
          position: pos.get(e.horse_id) ?? null,
          result: through ? "QUALIFIED" : "ELIMINATED",
        });
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
      else {
        await this.setEntry(c, t.id, e.horse_id, "SCRATCHED");
        outcome.get(e.horse_id)!.result = "SCRATCHED";
      }
    }
    const told = group(
      [...outcome.values()].map((o) => ({ ...o, owner_id: o.e.owner_id })),
      (o) => ({
        horseName: o.e.horse_name,
        heat: o.heat,
        position: o.position,
        result: o.result,
      }),
    );
    if (fit.length === 0) {
      await this.markCancelled(c, t, "No eligible finalists", now);
      await this.notifyOwners(c, t, "tournament_heats_result", told, { finalAt: null });
      await this.emitClosed(c, t, "No eligible finalists");
      return true;
    }
    await this.createFinal(c, t, fit, t.final_at, now);
    await this.notifyOwners(c, t, "tournament_heats_result", told, { finalAt: t.final_at.toISOString() });
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

  /**
   * Final settled: record placings, crown the best player finisher (the purse was paid by the
   * race). The final runs without house horses when it has two or more finalists, so this is the
   * race winner; only a lone finalist races house company and is champion wherever it finishes.
   */
  private async complete(c: PoolClient, t: TournamentRow, now: Date): Promise<boolean> {
    const final = await row<{ status: string }>(c, "SELECT status FROM races WHERE id = $1", [
      t.final_race_id,
    ]);
    if (!final || (final.status !== "COMPLETED" && final.status !== "CANCELLED")) return false;
    if (final.status === "CANCELLED") {
      const entries = await rows<EntryRow & { horse_name: string }>(
        c,
        `SELECT e.*, h.name AS horse_name FROM tournament_entries e JOIN horses h ON h.id = e.horse_id
          WHERE e.tournament_id = $1 AND e.status = 'FINALIST'`,
        [t.id],
      );
      for (const e of entries) {
        await this.setEntry(c, t.id, e.horse_id, "SCRATCHED");
        await this.refund(c, t, e, "Final cancelled");
      }
      await this.markCancelled(c, t, "Final cancelled", now);
      await this.notifyCancelled(c, t, entries, "Final cancelled");
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
    // A house-filled final is a real race: its winner is champion, house horse or not. Otherwise
    // the best player finisher is (only a lone finalist ever races house company there).
    const top = await row<{ horse_id: string; owner_id: string | null; is_house: boolean; name: string }>(
      c,
      `SELECT e.horse_id, e.owner_id, e.is_house, COALESCE(e.snapshot->>'name', h.name) AS name
         FROM race_entries e JOIN horses h ON h.id = e.horse_id
        WHERE e.race_id = $1 AND e.status = 'RAN' ORDER BY e.position LIMIT 1`,
      [t.final_race_id],
    );
    const field = (
      await rows<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1 AND status = 'RAN'",
        [t.final_race_id],
      )
    )[0]!.n;
    const houseWon = t.house_fill && !!top?.is_house;
    const champ = houseWon ? null : (results[0] ?? null);
    const tier = this.config.get().tournaments.tiers[t.tier];
    if (champ) {
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
      [t.id, now, houseWon ? top!.horse_id : (champ?.horse_id ?? null), champ?.owner_id ?? null],
    );
    // Every owner who took part hears how the whole tournament went for their horses.
    const all = await rows<EntryRow & { horse_name: string; prize: number | null }>(
      c,
      `SELECT e.*, h.name AS horse_name, re.prize FROM tournament_entries e JOIN horses h ON h.id = e.horse_id
         LEFT JOIN race_entries re ON re.race_id = $2 AND re.horse_id = e.horse_id
        WHERE e.tournament_id = $1 AND e.status <> 'WITHDRAWN' ORDER BY e.final_position NULLS LAST`,
      [t.id, t.final_race_id],
    );
    // Placings in the final: the race position when house horses ran in it, else among players.
    const finalRank = new Map(
      results.map((r, i) => [r.horse_id, t.house_fill ? r.position : i + 1] as const),
    );
    const champOwner = champ
      ? await row<{ name: string | null }>(
          c,
          "SELECT COALESCE(username, first_name) AS name FROM users WHERE id = $1",
          [champ.owner_id],
        )
      : null;
    await this.notifyOwners(
      c,
      t,
      "tournament_result",
      group(all, (e) => ({
        horseName: e.horse_name,
        status: e.status,
        finalRank: finalRank.get(e.horse_id) ?? null,
        heatPosition: e.heat_position,
        prize: e.prize ?? 0,
        champion: e.horse_id === champ?.horse_id,
      })),
      {
        finalists: t.house_fill ? field : results.length,
        championHorse: houseWon ? top!.name : (champ?.name ?? null),
        championOwner: champOwner?.name ?? null,
        championHouse: houseWon,
        championReputation: tier.championReputation,
        championPrestige: tier.championPrestige,
      },
    );
    await this.emitClosed(c, t, null);
    return true;
  }

  private async cancelInTx(c: PoolClient, t: TournamentRow, reason: string, now: Date): Promise<void> {
    const entries = await rows<EntryRow & { horse_name: string }>(
      c,
      `SELECT e.*, h.name AS horse_name FROM tournament_entries e JOIN horses h ON h.id = e.horse_id
        WHERE e.tournament_id = $1 AND e.status = 'REGISTERED' FOR UPDATE OF e`,
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
    await this.markCancelled(c, t, reason, now);
    await this.notifyCancelled(c, t, entries, reason);
    await this.emitClosed(c, t, reason);
  }

  private markCancelled(c: Queryable, t: TournamentRow, reason: string, now: Date) {
    return c.query(
      "UPDATE tournaments SET status = 'CANCELLED', completed_at = $2, cancel_reason = $3 WHERE id = $1",
      [t.id, now, reason],
    );
  }

  /** Owners whose horses were refunded hear that the tournament is off and their fee is back. */
  private async notifyCancelled(
    c: Queryable,
    t: TournamentRow,
    entries: (EntryRow & { horse_name: string })[],
    reason: string,
  ): Promise<void> {
    const byOwner = new Map<string, { names: string[]; refund: number }>();
    for (const e of entries) {
      const o = byOwner.get(e.owner_id) ?? { names: [], refund: 0 };
      o.names.push(e.horse_name);
      o.refund += e.entry_fee;
      byOwner.set(e.owner_id, o);
    }
    for (const [userId, o] of byOwner)
      await this.events.emit(c, {
        type: "tournament_called_off",
        aggregateType: "tournament",
        aggregateId: t.id,
        actorId: userId,
        payload: {
          userId,
          tournamentId: t.id,
          tournamentName: t.name,
          horses: o.names,
          refund: o.refund,
          reason,
        },
      });
  }

  /** One outbox event per owner (one Telegram message), listing what happened to each horse. */
  private async notifyOwners(
    c: Queryable,
    t: TournamentRow,
    type: string,
    byOwner: Map<string, Record<string, unknown>[]>,
    extra: Record<string, unknown>,
  ): Promise<void> {
    for (const [userId, horses] of byOwner)
      await this.events.emit(c, {
        type,
        aggregateType: "tournament",
        aggregateId: t.id,
        actorId: userId,
        payload: { userId, tournamentId: t.id, tournamentName: t.name, horses, ...extra },
      });
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
    const houseFillNow = this.config.get().tournaments.houseFill.enabled;
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
            ? {
                horseId: t.winner_horse_id,
                horseName: w.horse_name,
                ownerName: w.owner_name,
                house: !t.winner_owner_id,
              }
            : null,
        // Not drawn yet: what the switch says now; drawn: what the cup was drawn under.
        houseFill: t.status === "REGISTRATION" ? houseFillNow : t.house_fill,
        myEntries: mine.get(t.id) ?? [],
        cancelReason: t.status === "CANCELLED" ? (t.cancel_reason ?? null) : null,
        completedAt: t.completed_at?.toISOString() ?? null,
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

  /** Finished tournaments, newest first — all of them, or only those the viewer had a horse in. */
  async history(
    viewerId: string,
    q: TournamentHistoryQuery,
  ): Promise<{ items: TournamentDto[]; nextBefore: string | null }> {
    const list = await this.db.query<TournamentRow>(
      `SELECT t.* FROM tournaments t
        WHERE t.status IN ('COMPLETED','CANCELLED') AND ($2::timestamptz IS NULL OR t.heats_at < $2)
          AND (NOT $3 OR EXISTS (SELECT 1 FROM tournament_entries e
                                  WHERE e.tournament_id = t.id AND e.owner_id = $1 AND e.status <> 'WITHDRAWN'))
        ORDER BY t.heats_at DESC LIMIT $4`,
      [viewerId, q.before ?? null, q.mine, q.limit],
    );
    const items = await this.toDtos(list, viewerId);
    return {
      items,
      nextBefore: list.length === q.limit ? list[list.length - 1]!.heats_at.toISOString() : null,
    };
  }

  async detail(id: string, viewerId: string): Promise<TournamentDetailDto> {
    const t = await this.db.one<TournamentRow>("SELECT * FROM tournaments WHERE id = $1", [id]);
    if (!t) throw notFound("Tournament");
    const [dto] = await this.toDtos([t], viewerId);
    const entries = await this.entryViews([id], viewerId, false);
    const rounds = await this.rounds(t, viewerId);
    const tier = this.config.get().tournaments.tiers[t.tier];
    return {
      ...dto!,
      entries: entries.get(id) ?? [],
      rounds,
      standings: await this.standings(t, viewerId, rounds),
      championHonours: { prestige: tier.championPrestige, reputation: tier.championReputation },
    };
  }

  /** Every heat and the final with its whole field (house horses too) and how they finished. */
  private async rounds(t: TournamentRow, viewerId: string): Promise<TournamentRoundDto[]> {
    const races = await this.db.query<{
      id: string;
      stage: "HEAT" | "FINAL";
      name: string;
      status: TournamentRoundDto["status"];
      starts_at: Date;
      track_code: string;
      surface: string;
      distance: number;
      going: string;
      weather: string;
    }>(
      `SELECT id, stage, name, status, starts_at, track_code, surface, distance, going, weather
         FROM races WHERE tournament_id = $1 ORDER BY stage = 'FINAL', starts_at`,
      [t.id],
    );
    if (!races.length) return [];
    const runners = await this.db.query<{
      race_id: string;
      horse_id: string;
      horse_name: string;
      owner_id: string | null;
      owner_name: string | null;
      is_house: boolean;
      gate: number | null;
      strategy: string;
      position: number | null;
      finish_time: string | null;
      lengths_behind: string | null;
      prize: number | null;
    }>(
      `SELECT e.race_id, e.horse_id, COALESCE(e.snapshot->>'name', h.name) AS horse_name, e.owner_id,
              COALESCE(u.username, u.first_name) AS owner_name, e.is_house, e.gate, e.strategy, e.position,
              e.finish_time, e.lengths_behind, e.prize
         FROM race_entries e JOIN horses h ON h.id = e.horse_id LEFT JOIN users u ON u.id = e.owner_id
        WHERE e.race_id = ANY($1::uuid[]) AND e.status IN ('ENTERED','RAN')
        ORDER BY e.position NULLS LAST, e.gate NULLS LAST, h.name`,
      [races.map((r) => r.id)],
    );
    const finalId = races.find((r) => r.stage === "FINAL")?.id;
    const inFinal = new Set(
      runners.filter((r) => r.race_id === finalId && !r.is_house).map((r) => r.horse_id),
    );
    let heatNo = 0;
    return races.map((r) => ({
      raceId: r.id,
      stage: r.stage,
      no: r.stage === "HEAT" ? ++heatNo : 0,
      name: r.name,
      status: r.status,
      startsAt: r.starts_at.toISOString(),
      trackName: trackByCode(r.track_code).name,
      surface: r.surface,
      distance: r.distance,
      going: r.going,
      weather: r.weather,
      runners: runners
        .filter((x) => x.race_id === r.id)
        .map((x): TournamentRunnerDto => ({
          horseId: x.horse_id,
          horseName: x.horse_name,
          ownerId: x.is_house ? null : x.owner_id,
          ownerName: x.is_house ? null : x.owner_name,
          house: x.is_house,
          mine: !x.is_house && x.owner_id === viewerId,
          gate: x.gate === null ? null : x.gate + 1,
          strategy: x.strategy,
          position: x.position,
          finishTime: x.finish_time === null ? null : Number(x.finish_time),
          lengthsBehind: x.lengths_behind === null ? null : Number(x.lengths_behind),
          prize: x.prize,
          qualified: r.stage === "HEAT" && inFinal.has(x.horse_id),
        })),
    }));
  }

  /**
   * The table: finalists in their final order, then horses out in the heats grouped by their heat
   * placing (equal placings share a rank), scratched horses last without a rank. Ranks are given
   * once the tournament is over.
   */
  private async standings(
    t: TournamentRow,
    viewerId: string,
    rounds: TournamentRoundDto[],
  ): Promise<TournamentStandingDto[]> {
    const list = await this.db.query<EntryRow & { horse_name: string; owner_name: string | null }>(
      `SELECT e.*, h.name AS horse_name, COALESCE(u.username, u.first_name) AS owner_name
         FROM tournament_entries e JOIN horses h ON h.id = e.horse_id JOIN users u ON u.id = e.owner_id
        WHERE e.tournament_id = $1 AND e.status <> 'WITHDRAWN'`,
      [t.id],
    );
    const heatNo = new Map(rounds.filter((r) => r.stage === "HEAT").map((r) => [r.raceId, r.no] as const));
    const final = rounds.find((r) => r.stage === "FINAL");
    const prize = new Map((final?.runners ?? []).map((r) => [r.horseId, r.prize ?? 0] as const));
    const stage = (e: EntryRow) =>
      e.final_position !== null ? 0 : e.status === "FINALIST" ? 1 : e.status === "ELIMINATED" ? 2 : 3;
    const sorted = [...list].sort(
      (a, b) =>
        stage(a) - stage(b) ||
        (a.final_position ?? 99) - (b.final_position ?? 99) ||
        (a.heat_position ?? 99) - (b.heat_position ?? 99) ||
        a.horse_name.localeCompare(b.horse_name),
    );
    const done = t.status === "COMPLETED";
    const key = (e: EntryRow) => (stage(e) === 0 ? `F${e.final_position}` : `H${e.heat_position}`);
    // Finalists rank by their final placing (the race position when house horses ran in it);
    // horses out in the heats come after the last finalist, equal heat placings sharing a rank.
    const finalRank = (e: EntryRow, i: number) => (t.house_fill ? e.final_position! : i + 1);
    const lastFinal = Math.max(0, ...sorted.filter((e) => stage(e) === 0).map(finalRank));
    const out: TournamentStandingDto[] = [];
    sorted.forEach((e, i) => {
      const ranked = done && (stage(e) === 0 || (stage(e) === 2 && e.heat_position !== null));
      const prev = out[i - 1];
      const same = ranked && prev !== undefined && prev.rank !== null && key(sorted[i - 1]!) === key(e);
      const outRank =
        lastFinal +
        1 +
        sorted.filter((x) => stage(x) === 2 && (x.heat_position ?? 99) < (e.heat_position ?? 99)).length;
      const rank = !ranked ? null : same ? prev!.rank : stage(e) === 0 ? finalRank(e, i) : outRank;
      if (same) prev!.tied = true;
      out.push({
        rank,
        tied: same,
        horseId: e.horse_id,
        horseName: e.horse_name,
        ownerId: e.owner_id,
        ownerName: e.owner_name,
        mine: e.owner_id === viewerId,
        status: e.status,
        champion: e.horse_id === t.winner_horse_id,
        heatNo: e.heat_race_id ? (heatNo.get(e.heat_race_id) ?? null) : null,
        heatPosition: e.heat_position,
        finalPosition: e.final_position,
        prize: prize.get(e.horse_id) ?? 0,
      });
    });
    return out;
  }
}

/** Group rows by owner, mapping each to what the owner's message says about that horse. */
function group<T extends { owner_id: string }>(
  list: T[],
  f: (e: T) => Record<string, unknown>,
): Map<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>();
  for (const e of list) out.set(e.owner_id, [...(out.get(e.owner_id) ?? []), f(e)]);
  return out;
}
