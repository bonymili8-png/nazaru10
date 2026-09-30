import { createHmac, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  CallShowdownRaceRequest,
  CreateShowdownRequest,
  LiveRaceDto,
  RaceDetailDto,
  RaceEntryDto,
  ShowdownDto,
  ShowdownPlayerDto,
  ShowdownRaceDto,
  ShowdownRaceStatus,
  ShowdownSummaryDto,
} from "@thoroughline/contracts";
import {
  buildCommentary,
  favouriteSurface,
  goingLabel,
  projectCondition,
  raceAftermath,
  type RaceEntrant,
  type RaceEvent,
  type RaceFrames,
  type RaceResultRow,
  Rng,
  rollWeather,
  rollWetness,
  SHOWDOWN_CODE,
  showdownCode,
  showdownHorse,
  type ShowdownHorse,
  type ShowdownMode,
  showdownPoints,
  simulateRace,
  STRATEGIES,
  type Strategy,
  type Surface,
  TRACKS,
  trackByCode,
  type Weather,
} from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { ENV, type Env } from "../../config/env.js";

interface ShowdownRow {
  id: string;
  code: string;
  name: string;
  mode: ShowdownMode;
  fill_field: boolean;
  host_id: string;
  status: "OPEN" | "FINISHED";
  created_at: Date;
}

interface PlayerRow {
  showdown_id: string;
  user_id: string;
  display_name: string;
  horse: ShowdownHorse;
  fatigue: number;
  fatigue_at: Date;
  points: number;
  wins: number;
  races: number;
  joined_at: Date;
}

/** One runner as it went to post (players and pace horses). */
interface FieldEntry {
  id: string;
  userId: string | null;
  displayName: string | null;
  horseName: string;
  gate: number;
  strategy: Strategy;
  fatigue: number;
}

/** A runner's result; points and fatigue are applied to the standings when the result is public. */
interface ResultEntry {
  id: string;
  position: number;
  time: number;
  lengthsBehind: number;
  points: number;
  fatigueAfter: number;
}

interface RaceRow {
  id: string;
  showdown_id: string;
  no: number;
  track_code: string;
  distance: number;
  weather: Weather;
  wetness: 0 | 1 | 2 | 3;
  going: string;
  tactics: Record<string, Strategy>;
  resting: string[];
  status: "CALLED" | "RUN" | "SETTLED" | "CANCELLED";
  starts_at: Date;
  results_at: Date | null;
  field: FieldEntry[] | null;
  results: ResultEntry[] | null;
  frames: RaceFrames | null;
  events: RaceEvent[] | null;
  commentary: LiveRaceDto["commentary"] | null;
  winning_time: number | null;
}

const JOCKEY = "Showdown jockey";

/**
 * Showdowns (engine showdown/): exhibition tournaments for real people on tournament horses. A
 * host creates one and shares the code; players join, the host calls races one at a time, players
 * pick tactics (or rest) while a race is called, and the race is simulated at the off and
 * broadcast like any other. Nothing here touches wallets, ratings or anyone's stable.
 *
 * Races move CALLED → RUN (simulated at the off; the broadcast plays) → SETTLED (points and
 * fatigue applied once the result is public, so the standings never spoil a live race).
 */
@Injectable()
export class ShowdownsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /* ───────────────────────────── hosting and joining ───────────────────────────── */

  async create(userId: string, req: CreateShowdownRequest): Promise<ShowdownDto> {
    const cfg = this.config.get().showdown;
    const code = await this.db.tx(async (c) => {
      // Serialise one host's creations so the open-showdown cap holds.
      await c.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      const open = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM showdowns WHERE host_id = $1 AND status = 'OPEN'",
        [userId],
      );
      if (open!.n >= cfg.maxOpenPerHost)
        throw conflict("TOO_MANY_SHOWDOWNS", `Finish one of your ${cfg.maxOpenPerHost} open showdowns first`);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = showdownCode(new Rng(randomUUID()));
        const s = await row<{ id: string }>(
          c,
          `INSERT INTO showdowns (code, name, mode, fill_field, host_id) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (code) DO NOTHING RETURNING id`,
          [code, req.name, req.mode, req.fillField, userId],
        );
        if (!s) continue;
        await this.addPlayer(c, s.id, userId, req.displayName);
        return code;
      }
      throw conflict("TRY_AGAIN", "Could not create a showdown code, try again");
    });
    return this.get(code, userId);
  }

  async join(userId: string, code: string, displayName: string): Promise<ShowdownDto> {
    await this.db.tx(async (c) => {
      const s = await this.lockShowdown(c, code);
      if (s.status !== "OPEN") throw conflict("SHOWDOWN_FINISHED", "This showdown has finished");
      const players = await rows<{ user_id: string }>(
        c,
        "SELECT user_id FROM showdown_players WHERE showdown_id = $1",
        [s.id],
      );
      if (players.some((p) => p.user_id === userId)) return;
      if (players.length >= this.config.get().showdown.maxPlayers)
        throw conflict("SHOWDOWN_FULL", "This showdown is full");
      await this.addPlayer(c, s.id, userId, displayName);
    });
    return this.get(code, userId);
  }

  private async addPlayer(c: Queryable, showdownId: string, userId: string, displayName: string) {
    const taken = await row<{ n: number }>(
      c,
      "SELECT count(*)::int AS n FROM showdown_players WHERE showdown_id = $1 AND lower(display_name) = lower($2)",
      [showdownId, displayName],
    );
    if (taken!.n > 0) throw conflict("NAME_TAKEN", "Someone in this showdown already uses that name");
    const horse = showdownHorse(`${showdownId}:${userId}`, this.config.get());
    await c.query(
      `INSERT INTO showdown_players (showdown_id, user_id, display_name, horse, fatigue_at, joined_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [showdownId, userId, displayName, JSON.stringify(horse), this.clock.now()],
    );
  }

  /** The host removes a player (moderation: the broadcast is public). */
  async kick(hostId: string, code: string, userId: string): Promise<ShowdownDto> {
    await this.db.tx(async (c) => {
      const s = await this.lockShowdown(c, code);
      this.assertHost(s, hostId);
      if (userId === hostId) throw badRequest("HOST_STAYS", "The host cannot remove themselves");
      await c.query("DELETE FROM showdown_players WHERE showdown_id = $1 AND user_id = $2", [s.id, userId]);
    });
    return this.get(code, hostId);
  }

  async finish(hostId: string, code: string): Promise<ShowdownDto> {
    await this.db.tx(async (c) => {
      const s = await this.lockShowdown(c, code);
      this.assertHost(s, hostId);
      if (s.status === "FINISHED") return;
      // A race still waiting at the gates is called off; one already run plays out.
      await c.query(
        "UPDATE showdown_races SET status = 'CANCELLED' WHERE showdown_id = $1 AND status = 'CALLED'",
        [s.id],
      );
      await c.query("UPDATE showdowns SET status = 'FINISHED', finished_at = $2 WHERE id = $1", [
        s.id,
        this.clock.now(),
      ]);
    });
    return this.get(code, hostId);
  }

  /* ───────────────────────────── racing ───────────────────────────── */

  /** The host calls the next race; players have `callSeconds` to choose tactics. */
  async callRace(hostId: string, code: string, req: CallShowdownRaceRequest): Promise<ShowdownDto> {
    const cfg = this.config.get();
    const now = this.clock.now();
    await this.settleFor(code);
    await this.db.tx(async (c) => {
      const s = await this.lockShowdown(c, code);
      this.assertHost(s, hostId);
      if (s.status !== "OPEN") throw conflict("SHOWDOWN_FINISHED", "This showdown has finished");
      const busy = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM showdown_races WHERE showdown_id = $1 AND status IN ('CALLED', 'RUN')",
        [s.id],
      );
      if (busy!.n > 0) throw conflict("RACE_IN_PROGRESS", "Wait until the current race is over");
      const players = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM showdown_players WHERE showdown_id = $1",
        [s.id],
      );
      if (players!.n < (s.fill_field ? 1 : 2))
        throw conflict("NOT_ENOUGH_PLAYERS", "Wait for more players to join");
      if (req.distance !== null && !cfg.showdown.distances.includes(req.distance))
        throw badRequest("BAD_DISTANCE", `Distances: ${cfg.showdown.distances.join(", ")} m`);
      const last = await row<{ no: number }>(
        c,
        "SELECT COALESCE(max(no), 0)::int AS no FROM showdown_races WHERE showdown_id = $1",
        [s.id],
      );
      const no = last!.no + 1;
      const rng = new Rng(this.seed(`${s.id}:call:${no}`));
      const tracks = req.surface ? TRACKS.filter((t) => t.surface === req.surface) : TRACKS;
      const track = rng.pick(tracks);
      const distance = req.distance ?? rng.pick(cfg.showdown.distances);
      const weather = rollWeather(track, rng);
      const wetness = rollWetness(track, weather, rng);
      await c.query(
        `INSERT INTO showdown_races (showdown_id, no, track_code, distance, weather, wetness, going, starts_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          s.id,
          no,
          track.code,
          distance,
          weather,
          wetness,
          goingLabel(track.surface, wetness),
          new Date(now.getTime() + cfg.showdown.callSeconds * 1000),
        ],
      );
    });
    return this.get(code, hostId);
  }

  /** A player's tactics for the called race (null: sit it out and rest). */
  async setTactics(
    userId: string,
    code: string,
    raceId: string,
    strategy: Strategy | null,
  ): Promise<ShowdownDto> {
    await this.db.tx(async (c) => {
      const s = await this.showdownByCode(c, code);
      const me = await row(c, "SELECT 1 FROM showdown_players WHERE showdown_id = $1 AND user_id = $2", [
        s.id,
        userId,
      ]);
      if (!me) throw forbidden("You are not riding in this showdown");
      const r = await row<RaceRow>(
        c,
        "SELECT * FROM showdown_races WHERE id = $1 AND showdown_id = $2 FOR UPDATE",
        [raceId, s.id],
      );
      if (!r) throw notFound("Race");
      if (r.status !== "CALLED" || r.starts_at <= this.clock.now())
        throw conflict("RACE_OFF", "They're off — too late to change tactics");
      await c.query(
        `UPDATE showdown_races SET
            tactics = CASE WHEN $3::text IS NULL THEN tactics - $2 ELSE tactics || jsonb_build_object($2, $3::text) END,
            resting = CASE WHEN $3::text IS NULL
                           THEN (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(resting || to_jsonb($2::text)) x)
                           ELSE COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(resting) x WHERE x <> $2), '[]'::jsonb)
                      END
          WHERE id = $1`,
        [r.id, userId, strategy],
      );
    });
    return this.get(code, userId);
  }

  /** Job: run races at the off and settle them when the broadcast ends. */
  async runDue(): Promise<number> {
    const now = this.clock.now();
    const due = await rows<{ id: string }>(
      this.db.pool,
      `SELECT id FROM showdown_races
        WHERE (status = 'CALLED' AND starts_at <= $1) OR (status = 'RUN' AND results_at <= $1)
        ORDER BY starts_at LIMIT 50`,
      [now],
    );
    let n = 0;
    for (const { id } of due) if (await this.step(id)) n++;
    return n;
  }

  /** Bring one showdown's races up to date (called on reads, so no race waits on the job). */
  private async settleFor(code: string): Promise<void> {
    const due = await rows<{ id: string }>(
      this.db.pool,
      `SELECT r.id FROM showdown_races r JOIN showdowns s ON s.id = r.showdown_id
        WHERE s.code = $1 AND ((r.status = 'CALLED' AND r.starts_at <= $2) OR (r.status = 'RUN' AND r.results_at <= $2))`,
      [code, this.clock.now()],
    );
    for (const { id } of due) await this.step(id);
  }

  private step(raceId: string): Promise<boolean> {
    const now = this.clock.now();
    return this.db.tx(async (c) => {
      const r = await row<RaceRow>(c, "SELECT * FROM showdown_races WHERE id = $1 FOR UPDATE SKIP LOCKED", [
        raceId,
      ]);
      if (!r) return false;
      if (r.status === "CALLED" && r.starts_at <= now) return this.run(c, r);
      if (r.status === "RUN" && r.results_at! <= now) return this.settle(c, r);
      return false;
    });
  }

  private async run(c: Queryable, r: RaceRow): Promise<boolean> {
    const cfg = this.config.get();
    const s = (await row<ShowdownRow>(c, "SELECT * FROM showdowns WHERE id = $1", [r.showdown_id]))!;
    const players = await rows<PlayerRow>(
      c,
      "SELECT * FROM showdown_players WHERE showdown_id = $1 ORDER BY joined_at",
      [s.id],
    );
    const riding = players.filter((p) => !r.resting.includes(p.user_id));
    const seed = this.seed(`race:${r.id}`);
    const rng = new Rng(`field:${seed}`);
    const entrants: (RaceEntrant & { field: Omit<FieldEntry, "gate"> })[] = riding.map((p) => {
      const fatigue =
        s.mode === "NO_FATIGUE"
          ? 0
          : projectCondition(
              { fatigue: p.fatigue, health: 100, form: 0, updatedAt: p.fatigue_at },
              r.starts_at,
              p.horse.attributes.endurance,
              cfg,
            ).fatigue;
      const strategy = r.tactics[p.user_id] ?? "MID_PACK";
      return {
        ...this.entrant(`p:${p.user_id}`, p.horse, strategy, fatigue),
        field: {
          id: `p:${p.user_id}`,
          userId: p.user_id,
          displayName: p.display_name,
          horseName: p.horse.name,
          strategy,
          fatigue,
        },
      };
    });
    const pace = s.fill_field ? Math.max(0, cfg.showdown.fieldSize - entrants.length) : 0;
    for (let i = 0; i < pace; i++) {
      const h = showdownHorse(`pace:${r.id}:${i}`, cfg);
      const strategy = rng.pick(STRATEGIES);
      entrants.push({
        ...this.entrant(`pace:${i}`, h, strategy, 0),
        field: { id: `pace:${i}`, userId: null, displayName: null, horseName: h.name, strategy, fatigue: 0 },
      });
    }
    if (riding.length === 0 || entrants.length < 2) {
      await c.query("UPDATE showdown_races SET status = 'CANCELLED' WHERE id = $1", [r.id]);
      return true;
    }
    const gates = rng.shuffle(entrants.map((_, i) => i + 1));
    const field: FieldEntry[] = entrants.map((e, i) => ({ ...e.field, gate: gates[i]! }));
    const byGate = [...entrants].sort((a, b) => gates[entrants.indexOf(a)]! - gates[entrants.indexOf(b)]!);
    const sim = simulateRace(
      byGate.map(({ field: _f, ...e }) => e),
      { distance: r.distance, track: trackByCode(r.track_code), weather: r.weather, wetness: r.wetness },
      seed,
      cfg,
    );
    const commentary = buildCommentary(
      sim.events,
      Object.fromEntries(entrants.map((e) => [e.id, e.name])),
      seed,
    );
    const results = this.score(sim.results, field, entrants, r, s.mode, rng);
    const resultsAt = new Date(r.starts_at.getTime() + Math.ceil(sim.winningTime + 2) * 1000);
    await c.query(
      `UPDATE showdown_races SET status = 'RUN', results_at = $2, field = $3, results = $4, frames = $5,
              events = $6, commentary = $7, winning_time = $8
        WHERE id = $1`,
      [
        r.id,
        resultsAt,
        JSON.stringify(field),
        JSON.stringify(results),
        JSON.stringify(sim.frames),
        JSON.stringify(sim.events),
        JSON.stringify(commentary),
        sim.winningTime,
      ],
    );
    return true;
  }

  /** Points by order among players; fatigue after the race (NORMAL mode) for the standings. */
  private score(
    sim: RaceResultRow[],
    field: FieldEntry[],
    entrants: (RaceEntrant & { field: Omit<FieldEntry, "gate"> })[],
    r: RaceRow,
    mode: ShowdownMode,
    rng: Rng,
  ): ResultEntry[] {
    const cfg = this.config.get();
    const byId = new Map(field.map((f) => [f.id, f] as const));
    const horses = new Map(entrants.map((e) => [e.id, e] as const));
    let playerRank = 0;
    return [...sim]
      .sort((a, b) => a.position - b.position)
      .map((res) => {
        const f = byId.get(res.entrantId)!;
        const isPlayer = f.userId !== null;
        if (isPlayer) playerRank++;
        const e = horses.get(res.entrantId)!;
        const fatigueAfter =
          isPlayer && mode === "NORMAL"
            ? raceAftermath(
                { fatigue: f.fatigue, health: 100, form: 0 },
                {
                  distance: r.distance,
                  position: res.position,
                  expectedPosition: Math.ceil(sim.length / 2),
                  fieldSize: sim.length,
                  endurance: e.attributes.endurance,
                  // No injuries in exhibitions.
                  susceptibility: 0,
                  strategy: f.strategy,
                },
                rng,
                cfg,
              ).condition.fatigue
            : 0;
        return {
          id: res.entrantId,
          position: res.position,
          time: res.time,
          lengthsBehind: res.lengthsBehind,
          points: isPlayer ? showdownPoints(playerRank, cfg) : 0,
          fatigueAfter,
        };
      });
  }

  private async settle(c: Queryable, r: RaceRow): Promise<boolean> {
    const field = new Map(r.field!.map((f) => [f.id, f] as const));
    for (const res of r.results!) {
      const f = field.get(res.id)!;
      if (!f.userId) continue;
      await c.query(
        `UPDATE showdown_players SET points = points + $3, wins = wins + $4, races = races + 1,
                fatigue = $5, fatigue_at = $6
          WHERE showdown_id = $1 AND user_id = $2`,
        [r.showdown_id, f.userId, res.points, res.position === 1 ? 1 : 0, res.fatigueAfter, r.results_at],
      );
    }
    await c.query("UPDATE showdown_races SET status = 'SETTLED' WHERE id = $1", [r.id]);
    return true;
  }

  private entrant(id: string, h: ShowdownHorse, strategy: Strategy, fatigue: number): RaceEntrant {
    const skill = this.config.get().showdown.jockeySkill;
    return {
      id,
      name: h.name,
      attributes: h.attributes,
      traits: h.traits,
      aptitudes: h.aptitudes,
      raceIntelligence: h.raceIntelligence,
      condition: { fatigue, health: 100, form: 0 },
      strategy,
      jockey: { id: "showdown-jockey", name: JOCKEY, skill },
    };
  }

  /* ───────────────────────────── reading ───────────────────────────── */

  async mine(userId: string): Promise<ShowdownSummaryDto[]> {
    const list = await rows<ShowdownRow & { players: number; races: number }>(
      this.db.pool,
      `SELECT s.*, (SELECT count(*)::int FROM showdown_players p WHERE p.showdown_id = s.id) AS players,
              (SELECT count(*)::int FROM showdown_races r WHERE r.showdown_id = s.id AND r.status IN ('RUN', 'SETTLED')) AS races
         FROM showdowns s
        WHERE s.host_id = $1 OR EXISTS (SELECT 1 FROM showdown_players p WHERE p.showdown_id = s.id AND p.user_id = $1)
        ORDER BY (s.status = 'OPEN') DESC, s.created_at DESC LIMIT 20`,
      [userId],
    );
    return list.map((s) => ({
      code: s.code,
      name: s.name,
      mode: s.mode,
      status: s.status,
      players: s.players,
      races: s.races,
      isHost: s.host_id === userId,
    }));
  }

  /** The showdown as a viewer sees it (`viewerId` null for the public broadcast page). */
  async get(code: string, viewerId: string | null): Promise<ShowdownDto> {
    if (!SHOWDOWN_CODE.test(code)) throw notFound("Showdown");
    await this.settleFor(code);
    const cfg = this.config.get();
    const now = this.clock.now();
    const s = await this.showdownByCode(this.db.pool, code);
    const players = await rows<PlayerRow>(
      this.db.pool,
      "SELECT * FROM showdown_players WHERE showdown_id = $1 ORDER BY points DESC, wins DESC, joined_at",
      [s.id],
    );
    const races = await rows<Omit<RaceRow, "frames" | "events" | "commentary">>(
      this.db.pool,
      `SELECT id, showdown_id, no, track_code, distance, weather, wetness, going, tactics, resting, status,
              starts_at, results_at, field, results, winning_time
         FROM showdown_races WHERE showdown_id = $1 ORDER BY no DESC LIMIT 30`,
      [s.id],
    );
    const host = players.find((p) => p.user_id === s.host_id);
    const hostName =
      host?.display_name ??
      (
        await row<{ name: string }>(
          this.db.pool,
          "SELECT COALESCE(username, first_name, 'Host') AS name FROM users WHERE id = $1",
          [s.host_id],
        )
      )?.name ??
      "Host";
    let rank = 0;
    const playerDtos: ShowdownPlayerDto[] = players.map((p) => ({
      userId: p.user_id,
      displayName: p.display_name,
      horseName: p.horse.name,
      rank: ++rank,
      points: p.points,
      wins: p.wins,
      races: p.races,
      fatigue:
        s.mode === "NO_FATIGUE"
          ? 0
          : Math.round(
              projectCondition(
                { fatigue: p.fatigue, health: 100, form: 0, updatedAt: p.fatigue_at },
                now,
                p.horse.attributes.endurance,
                cfg,
              ).fatigue,
            ),
      optimalDistance: Math.round(p.horse.aptitudes.optimalDistance / 50) * 50,
      favouriteSurface: favouriteSurface(p.horse.aptitudes),
      isHost: p.user_id === s.host_id,
      me: p.user_id === viewerId,
    }));
    const raceDtos = races.map((r) => this.raceDto(r, viewerId, now));
    const latest = races[0];
    const current =
      latest && (latest.status !== "CANCELLED" || latest.starts_at.getTime() > now.getTime() - 60_000)
        ? this.detail(latest, s, viewerId, now)
        : null;
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      mode: s.mode,
      fillField: s.fill_field,
      status: s.status,
      hostName,
      isHost: s.host_id === viewerId,
      joined: players.some((p) => p.user_id === viewerId),
      maxPlayers: cfg.showdown.maxPlayers,
      callSeconds: cfg.showdown.callSeconds,
      distances: cfg.showdown.distances,
      players: playerDtos,
      races: raceDtos,
      current,
    };
  }

  /** Live frames for a race, released in real time like any broadcast (public). */
  async live(code: string, raceId: string, viewerId: string | null): Promise<LiveRaceDto> {
    if (!SHOWDOWN_CODE.test(code)) throw notFound("Showdown");
    await this.settleFor(code);
    const now = this.clock.now();
    const r = await row<RaceRow & { code: string }>(
      this.db.pool,
      "SELECT r.*, s.code FROM showdown_races r JOIN showdowns s ON s.id = r.showdown_id WHERE r.id = $1 AND s.code = $2",
      [raceId, code],
    );
    if (!r) throw notFound("Race");
    const status = this.status(r, now);
    const elapsed = Math.round((now.getTime() - r.starts_at.getTime()) / 10) / 100;
    const base: LiveRaceDto = {
      raceId: r.id,
      status: status === "CALLED" ? "LOCKED" : status,
      elapsed,
      duration: null,
      distance: r.distance,
      frames: null,
      commentary: [],
      events: [],
      results: null,
    };
    if (!r.frames || status === "CANCELLED") return base;
    const finished = status === "COMPLETED";
    const upTo = finished ? Infinity : Math.max(0, elapsed);
    const count = finished
      ? r.frames.data.length
      : Math.min(r.frames.data.length, Math.floor(upTo / r.frames.interval) + 1);
    return {
      ...base,
      duration: r.winning_time,
      frames: { interval: r.frames.interval, ids: r.frames.ids, data: r.frames.data.slice(0, count) },
      commentary: r.commentary!.filter((l) => l.t <= upTo),
      events: r.events!.filter((e) => e.t <= upTo).map((e) => ({ t: e.t, type: e.type, horseId: e.horseId })),
      results: finished ? this.entries(r, viewerId, true) : null,
    };
  }

  private status(r: Pick<RaceRow, "status" | "results_at">, now: Date): ShowdownRaceStatus {
    if (r.status === "CALLED") return "CALLED";
    if (r.status === "CANCELLED") return "CANCELLED";
    return r.results_at! <= now ? "COMPLETED" : "RUNNING";
  }

  private raceDto(
    r: Omit<RaceRow, "frames" | "events" | "commentary">,
    viewerId: string | null,
    now: Date,
  ): ShowdownRaceDto {
    const status = this.status(r, now);
    const track = trackByCode(r.track_code);
    const field = new Map((r.field ?? []).map((f) => [f.id, f] as const));
    return {
      id: r.id,
      no: r.no,
      distance: r.distance,
      surface: track.surface as Surface,
      trackCode: track.code,
      trackName: track.name,
      weather: r.weather,
      going: r.going,
      status,
      startsAt: r.starts_at.toISOString(),
      resultsAt: r.results_at?.toISOString() ?? null,
      results:
        status === "COMPLETED" && r.results
          ? r.results
              .filter((x) => field.get(x.id)?.userId)
              .map((x) => ({
                displayName: field.get(x.id)!.displayName!,
                horseName: field.get(x.id)!.horseName,
                position: x.position,
                points: x.points,
              }))
          : null,
      myStrategy: viewerId
        ? (r.tactics[viewerId] ?? (r.resting.includes(viewerId) ? null : "MID_PACK"))
        : null,
      myResting: viewerId ? r.resting.includes(viewerId) : false,
    };
  }

  /** The current race in the shape the live view takes (the same component as real races). */
  private detail(
    r: Omit<RaceRow, "frames" | "events" | "commentary">,
    s: ShowdownRow,
    viewerId: string | null,
    now: Date,
  ): RaceDetailDto {
    const track = trackByCode(r.track_code);
    const status = this.status(r, now);
    return {
      id: r.id,
      name: `${s.name} · Race ${r.no}`,
      class: "MAIDEN",
      trackCode: track.code,
      trackName: track.name,
      surface: track.surface as Surface,
      distance: r.distance,
      weather: r.weather,
      going: r.going,
      entryFee: 0,
      purse: 0,
      status: status === "CALLED" ? "LOCKED" : status,
      locksAt: r.starts_at.toISOString(),
      startsAt: r.starts_at.toISOString(),
      entries: r.field?.length ?? 0,
      maxField: this.config.get().showdown.fieldSize,
      seedHash: "",
      tournamentId: null,
      entryList: this.entries(r, viewerId, status === "COMPLETED"),
      eligibility: { minRating: null, maxRating: null, maidenOnly: false },
      seed: null,
    };
  }

  private entries(
    r: Pick<RaceRow, "field" | "results">,
    viewerId: string | null,
    showResult: boolean,
  ): RaceEntryDto[] {
    const results = new Map((r.results ?? []).map((x) => [x.id, x] as const));
    return (r.field ?? [])
      .map((f) => {
        const res = showResult ? results.get(f.id) : undefined;
        return {
          horseId: f.id,
          horseName: f.horseName,
          ownerName: f.displayName,
          isHouse: f.userId === null,
          gate: f.gate,
          strategy: f.strategy,
          gear: null,
          jockeyName: JOCKEY,
          abilityRating: 0,
          raceRating: 0,
          position: res?.position ?? null,
          finishTime: res?.time ?? null,
          lengthsBehind: res?.lengthsBehind ?? null,
          prize: null,
          mine: f.userId !== null && f.userId === viewerId,
          silks: null,
          cloth: null,
          finishEffect: null,
        };
      })
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.gate - b.gate);
  }

  /* ───────────────────────────── helpers ───────────────────────────── */

  private seed(label: string): string {
    return createHmac("sha256", this.env.RACE_SEED_SECRET).update(`showdown:${label}`).digest("hex");
  }

  private async showdownByCode(c: Queryable, code: string): Promise<ShowdownRow> {
    const s = await row<ShowdownRow>(c, "SELECT * FROM showdowns WHERE code = $1", [code]);
    if (!s) throw notFound("Showdown");
    return s;
  }

  private async lockShowdown(c: Queryable, code: string): Promise<ShowdownRow> {
    if (!SHOWDOWN_CODE.test(code)) throw notFound("Showdown");
    const s = await row<ShowdownRow>(c, "SELECT * FROM showdowns WHERE code = $1 FOR UPDATE", [code]);
    if (!s) throw notFound("Showdown");
    return s;
  }

  private assertHost(s: ShowdownRow, userId: string) {
    if (s.host_id !== userId) throw forbidden("Only the host can do that");
  }
}
