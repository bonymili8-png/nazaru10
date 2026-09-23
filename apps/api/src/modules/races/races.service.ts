import { Injectable } from "@nestjs/common";
import type {
  LiveRaceDto,
  RaceDetailDto,
  RaceEntryDto,
  RaceListQuery,
  RaceSummaryDto,
} from "@thoroughline/contracts";
import { assertTransition, canRaceAtAge, round, type Strategy, trackByCode } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { LedgerService } from "../economy/ledger.service.js";
import { HorsesService } from "../horses/horses.service.js";
import { TrainingService } from "../training/training.service.js";
import type { EntryRow, RaceRow, ResultRow } from "./race.types.js";

type EntryViewRow = EntryRow & {
  horse_name: string;
  owner_name: string | null;
  ability_rating: number;
  race_rating: number;
  jockey_name: string | null;
};

@Injectable()
export class RacesService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly training: TrainingService,
    private readonly events: EventsService,
    private readonly clock: Clock,
  ) {}

  /* ───────────────────────────── entries ───────────────────────────── */

  async enter(userId: string, raceId: string, horseId: string, strategy: Strategy): Promise<RaceDetailDto> {
    await this.training.settleDueForOwner(userId);
    const now = this.clock.now();
    const cfg = this.config.get();
    await this.db.tx(async (c) => {
      // Lock order: race, then horse (same order everywhere → no deadlocks).
      const race = await row<RaceRow>(c, "SELECT * FROM races WHERE id = $1 FOR UPDATE", [raceId]);
      if (!race) throw notFound("Race");
      if (race.tournament_id)
        throw conflict("TOURNAMENT_RACE", "Tournament races are entered through tournament registration");
      if (race.status !== "OPEN" || race.locks_at <= now)
        throw conflict("ENTRIES_CLOSED", "Entries for this race are closed");
      let h = await this.horses.lockOwned(c, horseId, userId);
      h = await this.horses.normalize(c, h, now);
      if (h.status !== "IDLE") throw conflict("HORSE_BUSY", `Horse is ${h.status.toLowerCase()}`);
      assertTransition(h.status, "ENTERED");

      const age = this.horses.age(h, race.starts_at);
      if (!canRaceAtAge(age, cfg)) throw conflict("AGE_INELIGIBLE", "Horse is not of racing age");
      if (race.maiden_only && h.wins > 0)
        throw conflict("NOT_A_MAIDEN", "Maiden races are for horses that have never won");
      if (race.min_rating !== null && h.race_rating < race.min_rating)
        throw conflict("RATING_TOO_LOW", `Requires a rating of ${race.min_rating}+`);
      if (race.max_rating !== null && h.race_rating > race.max_rating)
        throw conflict("RATING_TOO_HIGH", `Limited to ratings up to ${race.max_rating}`);
      const cond = this.horses.condition(h, race.starts_at);
      if (cond.health < cfg.condition.minHealthToRace)
        throw conflict("HEALTH_TOO_LOW", "Horse is not healthy enough to race");
      if (cond.fatigue > cfg.condition.maxFatigueToRace) {
        throw conflict("TOO_FATIGUED", "Horse will still be too tired at the start time");
      }
      const count = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1 AND status = 'ENTERED'",
        [raceId],
      );
      if (count!.n >= race.max_field) throw conflict("FIELD_FULL", "This race is full");

      await c.query(
        "INSERT INTO race_entries (race_id, horse_id, owner_id, strategy, entry_fee) VALUES ($1, $2, $3, $4, $5)",
        [raceId, horseId, userId, strategy, race.entry_fee],
      );
      if (race.entry_fee > 0) {
        await this.ledger.debit(c, {
          userId,
          currency: "CREDITS",
          amount: race.entry_fee,
          sink: "RACE_ENTRY",
          key: `race:${raceId}:entry:${horseId}`,
          type: "RACE_ENTRY",
          reason: `Entry — ${race.name}`,
        });
      }
      await c.query("UPDATE horses SET status = 'ENTERED', updated_at = $2 WHERE id = $1", [horseId, now]);
      await this.events.emit(c, {
        type: "race_entered",
        aggregateType: "race",
        aggregateId: raceId,
        actorId: userId,
        payload: { horseId, strategy },
      });
    });
    return this.detail(raceId, userId);
  }

  async withdraw(userId: string, raceId: string, horseId: string): Promise<RaceDetailDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const race = await row<RaceRow>(c, "SELECT * FROM races WHERE id = $1 FOR UPDATE", [raceId]);
      if (!race) throw notFound("Race");
      if (race.status !== "OPEN" || race.locks_at <= now)
        throw conflict("ENTRIES_CLOSED", "Too late to withdraw — the field is locked");
      if (race.tournament_id)
        throw conflict(
          "TOURNAMENT_RACE",
          "Tournament runners cannot be withdrawn from a drawn heat or final",
        );
      const entry = await row<EntryRow>(
        c,
        "SELECT * FROM race_entries WHERE race_id = $1 AND horse_id = $2 AND owner_id = $3 AND status = 'ENTERED' FOR UPDATE",
        [raceId, horseId, userId],
      );
      if (!entry) throw notFound("Entry");
      await this.horses.lockOwned(c, horseId, userId);
      await c.query("UPDATE race_entries SET status = 'WITHDRAWN' WHERE id = $1", [entry.id]);
      if (entry.entry_fee > 0) {
        await this.ledger.credit(c, {
          userId,
          currency: "CREDITS",
          amount: entry.entry_fee,
          source: "RACE_REFUND",
          key: `race:${raceId}:withdraw:${horseId}`,
          type: "RACE_REFUND",
          reason: `Withdrawn — ${race.name}`,
        });
      }
      await c.query("UPDATE horses SET status = 'IDLE', updated_at = $2 WHERE id = $1", [horseId, now]);
      await this.events.emit(c, {
        type: "race_withdrawn",
        aggregateType: "race",
        aggregateId: raceId,
        actorId: userId,
        payload: { horseId },
      });
    });
    return this.detail(raceId, userId);
  }

  /* ───────────────────────────── views ───────────────────────────── */

  private displayStatus(r: RaceRow, now: Date): RaceSummaryDto["status"] {
    if (r.status === "RUNNING" || (r.status === "COMPLETED" && r.results_at && r.results_at > now))
      return "RUNNING";
    return r.status;
  }

  private summary(r: RaceRow, entries: number, now: Date): RaceSummaryDto {
    const track = trackByCode(r.track_code);
    return {
      id: r.id,
      name: r.name,
      class: r.class,
      trackCode: r.track_code,
      trackName: track.name,
      surface: r.surface,
      distance: r.distance,
      weather: r.weather,
      going: r.going,
      entryFee: r.entry_fee,
      purse: r.purse,
      status: this.displayStatus(r, now),
      locksAt: r.locks_at.toISOString(),
      startsAt: r.starts_at.toISOString(),
      entries,
      maxField: r.max_field,
      seedHash: r.seed_hash,
      tournamentId: r.tournament_id,
    };
  }

  async list(q: RaceListQuery): Promise<RaceSummaryDto[]> {
    const now = this.clock.now();
    const where =
      q.status === "upcoming"
        ? "r.status = 'OPEN' AND r.locks_at > $1 AND r.tournament_id IS NULL"
        : q.status === "live"
          ? "(r.status IN ('LOCKED','RUNNING') OR (r.status = 'OPEN' AND r.locks_at <= $1))"
          : "r.status = 'COMPLETED'";
    const order = q.status === "recent" ? "r.starts_at DESC" : "r.starts_at ASC";
    const list = await this.db.query<RaceRow & { n: number }>(
      `SELECT r.*, (SELECT count(*)::int FROM race_entries e WHERE e.race_id = r.id AND e.status IN ('ENTERED','RAN')) AS n
         FROM races r WHERE ${where} AND ($2::text IS NULL OR r.class = $2) ORDER BY ${order} LIMIT $3`,
      [now, q.class ?? null, q.limit],
    );
    return list.map((r) => this.summary(r, r.n, now));
  }

  async myUpcoming(userId: string): Promise<RaceSummaryDto[]> {
    const now = this.clock.now();
    const list = await this.db.query<RaceRow & { n: number }>(
      `SELECT DISTINCT r.*, (SELECT count(*)::int FROM race_entries x WHERE x.race_id = r.id AND x.status IN ('ENTERED','RAN')) AS n
         FROM races r JOIN race_entries e ON e.race_id = r.id
        WHERE e.owner_id = $1 AND e.status IN ('ENTERED','RAN') AND (r.status IN ('OPEN','LOCKED','RUNNING') OR r.results_at > $2)
        ORDER BY r.starts_at LIMIT 20`,
      [userId, now],
    );
    return list.map((r) => this.summary(r, r.n, now));
  }

  private async entryViews(c: Queryable, raceId: string): Promise<EntryViewRow[]> {
    return rows<EntryViewRow>(
      c,
      `SELECT e.*, h.name AS horse_name, h.ability_rating, h.race_rating, j.name AS jockey_name,
              COALESCE(u.username, u.first_name) AS owner_name
         FROM race_entries e
         JOIN horses h ON h.id = e.horse_id
         LEFT JOIN users u ON u.id = e.owner_id
         LEFT JOIN jockeys j ON j.id = e.jockey_id
        WHERE e.race_id = $1 AND e.status IN ('ENTERED','RAN')
        ORDER BY e.gate NULLS LAST, e.created_at`,
      [raceId],
    );
  }

  private entryDto(e: EntryViewRow, viewerId: string | null, reveal: boolean): RaceEntryDto {
    const mine = viewerId !== null && e.owner_id === viewerId;
    return {
      horseId: e.horse_id,
      horseName: e.snapshot?.name ?? e.horse_name,
      ownerName: e.is_house ? null : (e.snapshot?.ownerName ?? e.owner_name),
      isHouse: e.is_house,
      gate: e.gate === null ? null : e.gate + 1,
      // Tactics stay private until the result is public.
      strategy: mine || reveal ? e.strategy : null,
      jockeyName: e.snapshot?.jockey.name ?? e.jockey_name,
      abilityRating: e.snapshot?.abilityRating ?? e.ability_rating,
      raceRating: e.rating_before ?? e.race_rating,
      position: reveal ? e.position : null,
      finishTime: reveal ? e.finish_time : null,
      lengthsBehind: reveal ? e.lengths_behind : null,
      prize: reveal ? e.prize : null,
      mine,
    };
  }

  async detail(raceId: string, viewerId: string | null): Promise<RaceDetailDto> {
    const now = this.clock.now();
    const r = await this.db.one<RaceRow>("SELECT * FROM races WHERE id = $1", [raceId]);
    if (!r) throw notFound("Race");
    const reveal =
      r.status === "COMPLETED" || (r.status === "RUNNING" && !!r.results_at && r.results_at <= now);
    const entries = await this.entryViews(this.db.pool, raceId);
    const list = entries.map((e) => this.entryDto(e, viewerId, reveal));
    if (reveal) list.sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    return {
      ...this.summary(r, entries.length, now),
      entryList: list,
      eligibility: { minRating: r.min_rating, maxRating: r.max_rating, maidenOnly: r.maiden_only },
      seed: r.status === "COMPLETED" ? r.seed : null,
    };
  }

  /**
   * Live view: frames and commentary are released in real time relative to the start, so the
   * result cannot be read ahead of the broadcast.
   */
  async live(raceId: string, viewerId: string | null): Promise<LiveRaceDto> {
    const now = this.clock.now();
    const r = await this.db.one<RaceRow>("SELECT * FROM races WHERE id = $1", [raceId]);
    if (!r) throw notFound("Race");
    const elapsed = round((now.getTime() - r.starts_at.getTime()) / 1000, 2);
    const base: LiveRaceDto = {
      raceId,
      status: this.displayStatus(r, now),
      elapsed,
      duration: null,
      distance: r.distance,
      frames: null,
      commentary: [],
      events: [],
      results: null,
    };
    if (r.status !== "RUNNING" && r.status !== "COMPLETED") return base;
    const res = await this.db.one<ResultRow>("SELECT * FROM race_results WHERE race_id = $1", [raceId]);
    if (!res) return base;
    const finished = !!r.results_at && r.results_at <= now;
    const upTo = finished ? Infinity : Math.max(0, elapsed);
    const frameCount = finished
      ? res.frames.data.length
      : Math.min(res.frames.data.length, Math.floor(upTo / res.frames.interval) + 1);
    const entries = finished
      ? (await this.entryViews(this.db.pool, raceId)).map((e) => this.entryDto(e, viewerId, true))
      : null;
    return {
      ...base,
      duration: res.winning_time,
      frames: {
        interval: res.frames.interval,
        ids: res.frames.ids,
        data: res.frames.data.slice(0, frameCount),
      },
      commentary: res.commentary.filter((l) => l.t <= upTo),
      events: res.events
        .filter((e) => e.t <= upTo)
        .map((e) => ({ t: e.t, type: e.type, horseId: e.horseId })),
      results: entries ? entries.sort((a, b) => (a.position ?? 99) - (b.position ?? 99)) : null,
    };
  }

  async horseHistory(horseId: string, limit = 20) {
    return this.db.query<{
      race_id: string;
      name: string;
      class: string;
      distance: number;
      starts_at: Date;
      position: number | null;
      prize: number | null;
      field: number;
    }>(
      `SELECT r.id AS race_id, r.name, r.class, r.distance, r.starts_at, e.position, e.prize,
              (SELECT count(*)::int FROM race_entries x WHERE x.race_id = r.id AND x.status = 'RAN') AS field
         FROM race_entries e JOIN races r ON r.id = e.race_id
        WHERE e.horse_id = $1 AND e.status = 'RAN' ORDER BY r.starts_at DESC LIMIT $2`,
      [horseId, limit],
    );
  }
}
