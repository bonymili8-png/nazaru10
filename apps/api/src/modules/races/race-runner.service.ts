import { Inject, Injectable } from "@nestjs/common";
import {
  buildCommentary,
  goingLabel,
  RACE_CLASSES,
  raceAftermath,
  type RaceClass,
  type RaceEntrant,
  Rng,
  rollWeather,
  rollWetness,
  seedHash,
  simulateRace,
  splitPurse,
  TRACKS,
  trackByCode,
  updateRatings,
} from "@thoroughline/engine";
import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { badRequest, conflict, notFound } from "../../common/errors.js";
import { AuditService, EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { ENV, type Env } from "../../config/env.js";
import { LedgerService } from "../economy/ledger.service.js";
import type { HorseRow } from "../horses/horse.repo.js";
import { HorsesService } from "../horses/horses.service.js";
import { QuestsService } from "../quests/quests.service.js";
import { HouseService } from "./house.service.js";
import {
  CLASS_LABEL,
  type EntryRow,
  type EntrySnapshot,
  type RaceRow,
  type ResultRow,
} from "./race.types.js";

const REFERRAL_REWARD = 500;
const REFERRAL_DAILY_CAP = 10;

/**
 * Server-authoritative race lifecycle: schedule → lock (fill field, gates, jockeys, snapshot)
 * → run (deterministic simulation) → settle (prizes, ratings, condition). Every step is a
 * single transaction guarded by a status check and row lock, so re-running a step (crash,
 * restart, concurrent workers) is a no-op.
 */
@Injectable()
export class RaceRunnerService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly horses: HorsesService,
    private readonly house: HouseService,
    private readonly quests: QuestsService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  raceSeed(raceId: string): string {
    return createHmac("sha256", this.env.RACE_SEED_SECRET).update(`race:${raceId}`).digest("hex");
  }

  /* ───────────────────────────── scheduling ───────────────────────────── */

  /** Create the regular race card for the upcoming window (idempotent per slot). */
  async scheduleAhead(): Promise<number> {
    const now = this.clock.now();
    const cfg = this.config.get();
    const sch = cfg.race.schedule;
    let created = 0;
    for (const [k, cls] of RACE_CLASSES.entries()) {
      const step = sch.everyMinutes[cls] * 60_000;
      // Stagger classes so the card doesn't start all at once.
      const offset = ((k * 3 * 60_000) % step) as number;
      const earliest = now.getTime() + (sch.lockMinutesBefore + 1) * 60_000;
      const horizon = now.getTime() + sch.openMinutesAhead * 60_000;
      for (let t = Math.ceil((earliest - offset) / step) * step + offset; t <= horizon; t += step) {
        const startsAt = new Date(t);
        const rng = new Rng(`slot:${cls}:${startsAt.toISOString()}`);
        const track = rng.pick(TRACKS);
        const distance = rng.pick(track.distances);
        if (await this.insertRace({ cls, trackCode: track.code, distance, startsAt, rng, special: false }))
          created++;
      }
    }
    return created;
  }

  async createSpecial(
    actorId: string,
    input: {
      name: string;
      cls: RaceClass;
      trackCode: string;
      distance: number;
      startsAt: Date;
      purse?: number;
      entryFee?: number;
    },
  ): Promise<string> {
    const cfg = this.config.get();
    const track = TRACKS.find((t) => t.code === input.trackCode);
    if (!track) throw badRequest("UNKNOWN_TRACK", "Unknown track");
    if (
      input.startsAt.getTime() <
      this.clock.now().getTime() + (cfg.race.schedule.lockMinutesBefore + 5) * 60_000
    ) {
      throw badRequest("TOO_SOON", "Special races must start at least a few minutes from now");
    }
    const id = await this.insertRace({
      cls: input.cls,
      trackCode: track.code,
      distance: input.distance,
      startsAt: input.startsAt,
      rng: new Rng(randomUUID()),
      special: true,
      name: input.name,
      purse: input.purse,
      entryFee: input.entryFee,
      createdBy: actorId,
    });
    await this.audit.log(this.db.pool, {
      actorId,
      action: "RACE_CREATE_SPECIAL",
      targetType: "race",
      targetId: id,
      after: { ...input, startsAt: input.startsAt.toISOString() },
    });
    return id!;
  }

  private async insertRace(a: {
    cls: RaceClass;
    trackCode: string;
    distance: number;
    startsAt: Date;
    rng: Rng;
    special: boolean;
    name?: string;
    purse?: number;
    entryFee?: number;
    createdBy?: string;
  }): Promise<string | null> {
    const cfg = this.config.get();
    const cc = cfg.race.classes[a.cls];
    const track = trackByCode(a.trackCode);
    const weather = rollWeather(track, a.rng);
    const wetness = rollWetness(track, weather, a.rng);
    const id = randomUUID();
    const r = await this.db.one<{ id: string }>(
      `INSERT INTO races (id, name, class, track_code, surface, distance, weather, wetness, going, entry_fee, purse,
                          min_rating, max_rating, maiden_only, min_field, max_field, locks_at, starts_at, seed_hash,
                          is_special, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        id,
        a.name ?? `${track.name} ${CLASS_LABEL[a.cls]}`,
        a.cls,
        track.code,
        track.surface,
        a.distance,
        weather,
        wetness,
        goingLabel(track.surface, wetness),
        a.entryFee ?? cc.entryFee,
        a.purse ?? cc.purse,
        cc.minRating,
        cc.maxRating,
        cc.maidenOnly,
        2,
        cfg.race.maxField,
        new Date(a.startsAt.getTime() - cfg.race.schedule.lockMinutesBefore * 60_000),
        a.startsAt,
        seedHash(this.raceSeed(id)),
        a.special,
        a.createdBy ?? null,
      ],
    );
    return r?.id ?? null;
  }

  /* ─────────────────────────────── lock ─────────────────────────────── */

  async lockDue(): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM races WHERE status = 'OPEN' AND locks_at <= $1 ORDER BY locks_at LIMIT 50",
      [this.clock.now()],
    );
    let n = 0;
    for (const r of due) if (await this.lock(r.id)) n++;
    return n;
  }

  /** Close entries, fill the field with house horses, draw gates and jockeys, snapshot every runner. */
  async lock(raceId: string): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const race = await row<RaceRow>(c, "SELECT * FROM races WHERE id = $1 FOR UPDATE SKIP LOCKED", [
        raceId,
      ]);
      if (!race || race.status !== "OPEN" || race.locks_at > now) return false;
      const players = await rows<EntryRow>(
        c,
        "SELECT * FROM race_entries WHERE race_id = $1 AND status = 'ENTERED' AND NOT is_house ORDER BY created_at",
        [raceId],
      );
      if (players.length === 0) {
        // Nobody entered: skip the race entirely (no house-only races in MVP).
        await c.query("UPDATE races SET status = 'CANCELLED', completed_at = $2 WHERE id = $1", [
          raceId,
          now,
        ]);
        return true;
      }
      const rng = new Rng(`lock:${this.raceSeed(raceId)}`);
      const fieldSize = Math.min(race.max_field, Math.max(cfg.race.schedule.targetField, players.length));
      const fillers = await this.house.fillers(
        c,
        race.class,
        fieldSize - players.length,
        race.distance,
        now,
        rng.fork("fillers"),
      );
      for (const f of fillers) {
        await c.query(
          "INSERT INTO race_entries (race_id, horse_id, is_house, strategy) VALUES ($1, $2, true, $3)",
          [
            raceId,
            f.id,
            rng.pick([
              "FRONT_RUNNER",
              "PACE_SETTER",
              "MID_PACK",
              "MID_PACK",
              "CLOSER",
              "CONSERVATIVE",
              "AGGRESSIVE",
            ]),
          ],
        );
        await c.query("UPDATE horses SET status = 'ENTERED', updated_at = $2 WHERE id = $1", [f.id, now]);
      }
      const entries = await rows<EntryRow>(
        c,
        "SELECT * FROM race_entries WHERE race_id = $1 AND status = 'ENTERED' ORDER BY horse_id",
        [raceId],
      );
      const horseRows = new Map(
        (
          await rows<HorseRow>(c, "SELECT * FROM horses WHERE id = ANY($1::uuid[]) FOR UPDATE", [
            entries.map((e) => e.horse_id),
          ])
        ).map((h) => [h.id, h] as const),
      );
      const gates = rng.shuffle(entries.map((_, i) => i));
      const jockeys = await this.house.pickJockeys(c, race.class, entries.length, rng.fork("jockeys"));
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const h = horseRows.get(e.horse_id)!;
        const jockey = jockeys[i % jockeys.length]!;
        const snapshot: EntrySnapshot = {
          name: h.name,
          ownerName: await this.horses.ownerName(h.owner_id, c),
          attributes: h.attributes,
          traits: h.genome.traits,
          aptitudes: h.genome.aptitudes,
          raceIntelligence: h.genome.hidden.raceIntelligence,
          injurySusceptibility: h.genome.hidden.injurySusceptibility,
          condition: this.horses.condition(h, race.starts_at),
          abilityRating: h.ability_rating,
          raceRating: h.race_rating,
          jockey: { id: jockey.id, name: jockey.name, skill: jockey.skill },
        };
        await c.query(
          "UPDATE race_entries SET gate = $2, jockey_id = $3, snapshot = $4, rating_before = $5 WHERE id = $1",
          [e.id, gates[i], jockey.id, JSON.stringify(snapshot), h.race_rating],
        );
      }
      await c.query("UPDATE races SET status = 'LOCKED' WHERE id = $1", [raceId]);
      await this.events.emit(c, {
        type: "race_locked",
        aggregateType: "race",
        aggregateId: raceId,
        payload: { field: entries.length },
      });
      return true;
    });
  }

  /* ─────────────────────────────── run ─────────────────────────────── */

  async runDue(): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM races WHERE status = 'LOCKED' AND starts_at <= $1 ORDER BY starts_at LIMIT 50",
      [this.clock.now()],
    );
    let n = 0;
    for (const r of due) if (await this.run(r.id)) n++;
    return n;
  }

  /** Simulate the race and store the result; payouts happen at settlement (after the "live" broadcast). */
  async run(raceId: string): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const race = await row<RaceRow>(c, "SELECT * FROM races WHERE id = $1 FOR UPDATE SKIP LOCKED", [
        raceId,
      ]);
      if (!race || race.status !== "LOCKED" || race.starts_at > now) return false;
      const entries = await rows<EntryRow>(
        c,
        "SELECT * FROM race_entries WHERE race_id = $1 AND status = 'ENTERED' ORDER BY gate",
        [raceId],
      );
      if (entries.length < 2) {
        await this.cancelInTx(c, race, "Not enough runners", null, now);
        return true;
      }
      const seed = this.raceSeed(raceId);
      const entrants: RaceEntrant[] = entries.map((e) => {
        const s = e.snapshot!;
        return {
          id: e.horse_id,
          name: s.name,
          attributes: s.attributes,
          traits: s.traits,
          aptitudes: s.aptitudes,
          raceIntelligence: s.raceIntelligence,
          condition: s.condition,
          strategy: e.strategy,
          jockey: s.jockey,
          weightKg: e.weight_kg,
        };
      });
      const track = trackByCode(race.track_code);
      const sim = simulateRace(
        entrants,
        { distance: race.distance, track, weather: race.weather, wetness: race.wetness },
        seed,
        cfg,
      );
      const commentary = buildCommentary(
        sim.events,
        Object.fromEntries(entrants.map((e) => [e.id, e.name])),
        seed,
      );

      const byHorse = new Map(entries.map((e) => [e.horse_id, e] as const));
      const prizes = splitPurse(
        race.purse,
        sim.results.map((r) => ({ id: r.entrantId, position: r.position })),
        cfg.race.prizeSplit,
      );
      const ratings = updateRatings(
        sim.results.map((r) => ({
          id: r.entrantId,
          rating: byHorse.get(r.entrantId)!.rating_before ?? cfg.race.initialRating,
          position: r.position,
        })),
        cfg.race.eloK,
      );
      for (const r of sim.results) {
        await c.query(
          `UPDATE race_entries SET position = $2, finish_time = $3, lengths_behind = $4, prize = $5, rating_after = $6
            WHERE race_id = $1 AND horse_id = $7`,
          [
            raceId,
            r.position,
            r.time,
            r.lengthsBehind,
            prizes.get(r.entrantId) ?? 0,
            ratings.get(r.entrantId),
            r.entrantId,
          ],
        );
      }
      await c.query(
        "INSERT INTO race_results (race_id, results, events, commentary, frames, winning_time) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          raceId,
          JSON.stringify(sim.results),
          JSON.stringify(sim.events),
          JSON.stringify(commentary),
          JSON.stringify(sim.frames),
          sim.winningTime,
        ],
      );
      const resultsAt = new Date(race.starts_at.getTime() + Math.ceil(sim.winningTime + 2) * 1000);
      await c.query("UPDATE races SET status = 'RUNNING', results_at = $2 WHERE id = $1", [
        raceId,
        resultsAt,
      ]);
      await c.query("UPDATE horses SET status = 'RACING', updated_at = $2 WHERE id = ANY($1::uuid[])", [
        entries.map((e) => e.horse_id),
        now,
      ]);
      await this.events.emit(c, {
        type: "race_started",
        aggregateType: "race",
        aggregateId: raceId,
        payload: { field: entries.length },
      });
      return true;
    });
  }

  /* ───────────────────────────── settlement ───────────────────────────── */

  async settleDue(): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      "SELECT id FROM races WHERE status = 'RUNNING' AND results_at <= $1 ORDER BY results_at LIMIT 50",
      [this.clock.now()],
    );
    let n = 0;
    for (const r of due) if (await this.settle(r.id)) n++;
    return n;
  }

  async settle(raceId: string): Promise<boolean> {
    const now = this.clock.now();
    const cfg = this.config.get();
    return this.db.tx(async (c) => {
      const race = await row<RaceRow>(c, "SELECT * FROM races WHERE id = $1 FOR UPDATE SKIP LOCKED", [
        raceId,
      ]);
      if (!race || race.status !== "RUNNING" || !race.results_at || race.results_at > now) return false;
      const result = await row<ResultRow>(c, "SELECT * FROM race_results WHERE race_id = $1", [raceId]);
      if (!result) throw new Error(`race ${raceId} is RUNNING without a result`);
      const entries = await rows<EntryRow>(
        c,
        "SELECT * FROM race_entries WHERE race_id = $1 AND status = 'ENTERED' ORDER BY position",
        [raceId],
      );
      const horses = new Map(
        (
          await rows<HorseRow>(c, "SELECT * FROM horses WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [
            entries.map((e) => e.horse_id),
          ])
        ).map((h) => [h.id, h] as const),
      );
      // Expected finishing order = pre-race ability order (drives form changes).
      const expected = new Map(
        [...entries]
          .sort((a, b) => b.snapshot!.abilityRating - a.snapshot!.abilityRating)
          .map((e, i) => [e.horse_id, i + 1] as const),
      );
      const rep = cfg.race.classes[race.class].reputation;
      const seed = this.raceSeed(raceId);

      for (const e of entries) {
        const h = horses.get(e.horse_id)!;
        const s = e.snapshot!;
        const pos = e.position!;
        const prize = e.prize ?? 0;
        const after = raceAftermath(
          s.condition,
          {
            distance: race.distance,
            position: pos,
            expectedPosition: expected.get(e.horse_id)!,
            fieldSize: entries.length,
            endurance: s.attributes.endurance,
            susceptibility: s.injurySusceptibility,
            strategy: e.strategy,
          },
          new Rng(`aftermath:${seed}:${e.horse_id}`),
          cfg,
        );
        const injuredUntil = after.injury
          ? new Date(race.results_at.getTime() + after.injury.hours * 3_600_000)
          : null;
        await c.query(
          `UPDATE horses SET starts = starts + 1, wins = wins + $2, seconds = seconds + $3, thirds = thirds + $4,
                  earnings = earnings + $5, race_rating = $6, fatigue = $7, health = $8, form = $9,
                  condition_updated_at = $10, status = $11, injured_until = $12, updated_at = $13
            WHERE id = $1`,
          [
            h.id,
            pos === 1 ? 1 : 0,
            pos === 2 ? 1 : 0,
            pos === 3 ? 1 : 0,
            prize,
            e.rating_after ?? h.race_rating,
            after.condition.fatigue,
            after.condition.health,
            after.condition.form,
            race.results_at,
            after.injury ? "INJURED" : "IDLE",
            injuredUntil,
            now,
          ],
        );
        if (after.injury) {
          await c.query(
            `INSERT INTO injuries (horse_id, source, source_id, severity, heals_at, factors) VALUES ($1, 'RACE', $2, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [
              h.id,
              raceId,
              after.injury.severity,
              injuredUntil,
              JSON.stringify({ chance: after.injury.chance }),
            ],
          );
        }
        await c.query("UPDATE race_entries SET status = 'RAN' WHERE id = $1", [e.id]);
        await c.query("UPDATE jockeys SET rides = rides + 1, wins = wins + $2 WHERE id = $1", [
          e.jockey_id,
          pos === 1 ? 1 : 0,
        ]);

        if (e.is_house || !e.owner_id) continue;
        const owner = e.owner_id;
        if (prize > 0) {
          await this.ledger.credit(c, {
            userId: owner,
            currency: "CREDITS",
            amount: prize,
            source: "RACE_PRIZE",
            key: `race:${raceId}:prize:${e.horse_id}`,
            type: "RACE_PRIZE",
            reason: `${ordinal(pos)} — ${race.name}`,
            metadata: { raceId, horseId: e.horse_id, position: pos },
          });
        }
        const reputation = pos <= 3 ? rep[pos - 1]! : 0;
        if (reputation > 0) {
          await this.ledger.credit(c, {
            userId: owner,
            currency: "REPUTATION",
            amount: reputation,
            source: "RACE_PRIZE",
            key: `race:${raceId}:reputation:${e.horse_id}`,
            type: "RACE_REPUTATION",
            reason: race.name,
          });
        }
        await this.quests.complete(c, owner, "FIRST_RACE", now);
        if (pos <= 3) await this.quests.complete(c, owner, "FIRST_PODIUM", now);
        if (pos === 1) await this.quests.complete(c, owner, "FIRST_WIN", now);
        await this.referralReward(c, owner, now);
        await this.events.emit(c, {
          type: "race_result",
          aggregateType: "race",
          aggregateId: raceId,
          actorId: owner,
          payload: {
            userId: owner,
            raceId,
            raceName: race.name,
            horseId: e.horse_id,
            horseName: s.name,
            position: pos,
            field: entries.length,
            prize,
            injury: after.injury?.severity ?? null,
          },
        });
      }
      await c.query("UPDATE races SET status = 'COMPLETED', completed_at = $2, seed = $3 WHERE id = $1", [
        raceId,
        now,
        seed,
      ]);
      await this.events.emit(c, {
        type: "race_completed",
        aggregateType: "race",
        aggregateId: raceId,
        payload: { winner: result.results[0]?.entrantId, winningTime: result.winning_time },
      });
      return true;
    });
  }

  /** Both referrer and referee earn a reward once the referee has run a race (anti-abuse: once, capped daily). */
  private async referralReward(c: Queryable, userId: string, now: Date): Promise<void> {
    const u = await row<{ referred_by: string | null; created_at: Date }>(
      c,
      "SELECT referred_by, created_at FROM users WHERE id = $1",
      [userId],
    );
    if (!u?.referred_by) return;
    const already = await row<{ id: number }>(
      c,
      "SELECT id FROM ledger_transactions WHERE idempotency_key = $1",
      [`referral:${userId}:referee`],
    );
    if (already) return;
    const recent = await row<{ n: number }>(
      c,
      `SELECT count(*)::int AS n FROM ledger_transactions WHERE type = 'REFERRAL_REWARD' AND metadata->>'referrer' = $1 AND created_at > $2`,
      [u.referred_by, new Date(now.getTime() - 86_400_000)],
    );
    const meta = { referrer: u.referred_by, referee: userId };
    await this.ledger.credit(c, {
      userId,
      currency: "CREDITS",
      amount: REFERRAL_REWARD,
      source: "REFERRAL_REWARD",
      key: `referral:${userId}:referee`,
      type: "REFERRAL_REWARD_REFEREE",
      reason: "Invited by a friend",
      metadata: meta,
    });
    if (recent!.n < REFERRAL_DAILY_CAP) {
      await this.ledger.credit(c, {
        userId: u.referred_by,
        currency: "CREDITS",
        amount: REFERRAL_REWARD,
        source: "REFERRAL_REWARD",
        key: `referral:${userId}:referrer`,
        type: "REFERRAL_REWARD",
        reason: "Your friend ran their first race",
        metadata: meta,
      });
    }
  }

  /* ─────────────────────────────── cancel ─────────────────────────────── */

  async cancel(raceId: string, reason: string, actorId: string): Promise<void> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const race = await row<RaceRow>(c, "SELECT * FROM races WHERE id = $1 FOR UPDATE", [raceId]);
      if (!race) throw notFound("Race");
      if (race.status !== "OPEN" && race.status !== "LOCKED")
        throw conflict("RACE_NOT_CANCELLABLE", `Race is ${race.status}`);
      await this.cancelInTx(c, race, reason, actorId, now);
    });
  }

  private async cancelInTx(
    c: PoolClient,
    race: RaceRow,
    reason: string,
    actorId: string | null,
    now: Date,
  ): Promise<void> {
    const entries = await rows<EntryRow>(
      c,
      "SELECT * FROM race_entries WHERE race_id = $1 AND status = 'ENTERED'",
      [race.id],
    );
    for (const e of entries) {
      if (!e.is_house && e.owner_id && e.entry_fee > 0) {
        await this.ledger.credit(c, {
          userId: e.owner_id,
          currency: "CREDITS",
          amount: e.entry_fee,
          source: "RACE_REFUND",
          key: `race:${race.id}:refund:${e.horse_id}`,
          type: "RACE_REFUND",
          reason: `Race cancelled: ${race.name}`,
        });
      }
      await c.query("UPDATE race_entries SET status = 'SCRATCHED' WHERE id = $1", [e.id]);
      await c.query(
        "UPDATE horses SET status = 'IDLE', updated_at = $2 WHERE id = $1 AND status IN ('ENTERED','RACING')",
        [e.horse_id, now],
      );
    }
    await c.query("UPDATE races SET status = 'CANCELLED', completed_at = $2 WHERE id = $1", [race.id, now]);
    await this.audit.log(c, {
      actorId,
      action: "RACE_CANCEL",
      targetType: "race",
      targetId: race.id,
      reason,
    });
    await this.events.emit(c, {
      type: "race_cancelled",
      aggregateType: "race",
      aggregateId: race.id,
      actorId,
      payload: { reason },
    });
  }
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
