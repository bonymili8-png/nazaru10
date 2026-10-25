import { Injectable } from "@nestjs/common";
import type {
  LiveRaceDto,
  PublicHorseDto,
  RaceDetailDto,
  RaceEntryDto,
  ShareVisitRequest,
  ViralStatsDto,
} from "@thoroughline/contracts";
import { ageInYears } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { notFound } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import type { HorseRow } from "../horses/horse.repo.js";
import { RacesService } from "../races/races.service.js";
import { clip, horseCardSvg, raceCardSvg, renderPng } from "./og-image.js";

const DAY = 86_400_000;

/** A small in-memory cache for rendered cards (a finished race never changes). */
class LruCache<V> {
  private readonly map = new Map<string, { v: V; until: number }>();
  constructor(private readonly max: number) {}
  get(k: string, now: number): V | undefined {
    const e = this.map.get(k);
    if (!e || e.until < now) return undefined;
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }
  set(k: string, v: V, ttlMs: number, now: number): void {
    this.map.delete(k);
    this.map.set(k, { v, until: now + ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

/**
 * Public share pages: a finished race's replay and a horse's card, readable without signing in,
 * plus their social preview images. Nothing private leaves here: no attributes, no tactics of
 * unfinished races, owners only by name of stable and only with their consent.
 */
@Injectable()
export class ShareService {
  private readonly cards = new LruCache<Buffer>(300);

  constructor(
    private readonly db: Db,
    private readonly races: RacesService,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
  ) {}

  /** Stable names of the owners who allow them on public pages. */
  private async publicStables(ownerIds: string[]): Promise<Map<string, string>> {
    if (!ownerIds.length) return new Map();
    const list = await this.db.query<{ id: string; name: string }>(
      `SELECT u.id, s.name FROM users u JOIN stables s ON s.owner_id = u.id
        WHERE u.id = ANY($1::uuid[]) AND (u.settings->>'publicStable') = 'true'`,
      [[...new Set(ownerIds)]],
    );
    return new Map(list.map((r) => [r.id, r.name] as const));
  }

  private sanitize(e: RaceEntryDto, stables: Map<string, string>): RaceEntryDto {
    return {
      ...e,
      ownerId: null,
      ownerName: e.isHouse || !e.ownerId ? null : (stables.get(e.ownerId) ?? null),
      mine: false,
    };
  }

  /** A finished race for its public replay page. */
  async race(id: string): Promise<RaceDetailDto> {
    const d = await this.races.detail(id, null);
    if (d.status !== "COMPLETED") throw notFound("Race");
    const stables = await this.publicStables(d.entryList.flatMap((e) => (e.ownerId ? [e.ownerId] : [])));
    return { ...d, entryList: d.entryList.map((e) => this.sanitize(e, stables)) };
  }

  /** The finished race's frames for the public replay. */
  async live(id: string): Promise<LiveRaceDto> {
    const l = await this.races.live(id, null);
    if (l.status !== "COMPLETED") throw notFound("Race");
    const stables = await this.publicStables(
      (l.results ?? []).flatMap((e) => (e.ownerId ? [e.ownerId] : [])),
    );
    return { ...l, results: l.results?.map((e) => this.sanitize(e, stables)) ?? null };
  }

  async horse(id: string): Promise<PublicHorseDto> {
    const h = await this.db.one<HorseRow>("SELECT * FROM horses WHERE id = $1", [id]);
    if (!h || !h.owner_id) throw notFound("Horse");
    const stables = await this.publicStables([h.owner_id]);
    const recent = await this.races.horseHistory(id, 5);
    return {
      id: h.id,
      name: h.name,
      sex: h.sex,
      age: Math.floor(ageInYears(h.birth_at, this.clock.now(), this.config.get())),
      coat: h.coat,
      retired: !!h.retired_at,
      raceRating: h.race_rating,
      starts: h.starts,
      wins: h.wins,
      seconds: h.seconds,
      thirds: h.thirds,
      earnings: h.earnings,
      stable: stables.get(h.owner_id) ?? null,
      recent: recent.map((r) => ({
        raceId: r.race_id,
        raceName: r.name,
        distance: r.distance,
        startsAt: r.starts_at.toISOString(),
        position: r.position,
        field: r.field,
      })),
    };
  }

  async raceImage(id: string): Promise<Buffer> {
    const now = Date.now();
    const hit = this.cards.get(`race:${id}`, now);
    if (hit) return hit;
    const r = await this.race(id);
    const podium = [...r.entryList]
      .filter((e) => e.position !== null)
      .sort((a, b) => a.position! - b.position!)
      .slice(0, 3)
      .map((e) => ({ name: e.horseName, time: e.finishTime }));
    const png = renderPng(
      raceCardSvg({
        raceName: r.name,
        meta: `${r.trackName} · ${r.distance}m ${cap(r.surface)} · ${cap(r.going)}`,
        podium,
      }),
    );
    this.cards.set(`race:${id}`, png, 7 * DAY, now);
    return png;
  }

  async horseImage(id: string): Promise<Buffer> {
    const now = Date.now();
    const hit = this.cards.get(`horse:${id}`, now);
    if (hit) return hit;
    const h = await this.horse(id);
    const png = renderPng(
      horseCardSvg({
        name: h.name,
        line: `${h.age}-year-old ${SEX[h.sex] ?? h.sex.toLowerCase()} · ${cap(h.coat)}`,
        record: `${h.starts} starts · ${h.wins} wins · ${h.seconds + h.thirds} places`,
        rating: h.raceRating,
        stable: h.stable ? clip(h.stable, 40) : null,
      }),
    );
    // A horse's record changes as it races: refresh the card every ten minutes.
    this.cards.set(`horse:${id}`, png, 10 * 60_000, now);
    return png;
  }

  /** Count a visit to a share page (per day, page and sharer). */
  async visit(v: ShareVisitRequest): Promise<void> {
    const day = this.clock.now().toISOString().slice(0, 10);
    await this.db.query(
      `INSERT INTO share_visits (day, kind, target, ref_code, visits) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (day, kind, target, ref_code) DO UPDATE SET visits = share_visits.visits + 1`,
      [day, v.kind, v.id, (v.ref ?? "").toUpperCase()],
    );
  }

  /** The viral loop over the last `days`: share visits → invited players → their first race. */
  async viral(days: number): Promise<ViralStatsDto> {
    const since = new Date(this.clock.now().getTime() - days * DAY);
    const visits = (await this.db.one<{ all: number; shared: number; sharers: number }>(
      `SELECT COALESCE(sum(visits), 0)::int AS all,
              COALESCE(sum(visits) FILTER (WHERE ref_code <> ''), 0)::int AS shared,
              count(DISTINCT ref_code) FILTER (WHERE ref_code <> '')::int AS sharers
         FROM share_visits WHERE day >= $1::date`,
      [since],
    ))!;
    const refs = (await this.db.one<{ signups: number; raced: number }>(
      `SELECT count(*)::int AS signups,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM race_entries e
                                              WHERE e.owner_id = u.id AND e.status = 'RAN' AND NOT e.is_house))::int AS raced
         FROM users u WHERE u.referred_by IS NOT NULL AND u.created_at >= $1`,
      [since],
    ))!;
    const active = (await this.db.one<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE last_seen_at >= $1 AND role <> 'SYSTEM'",
      [since],
    ))!.n;
    return {
      days,
      shareVisits: visits.all,
      sharedByPlayers: visits.shared,
      sharers: visits.sharers,
      referredSignups: refs.signups,
      referredFirstRace: refs.raced,
      activePlayers: active,
      kFactor: active ? Math.round((refs.raced / active) * 1000) / 1000 : 0,
    };
  }
}

const SEX: Record<string, string> = {
  COLT: "colt",
  FILLY: "filly",
  MARE: "mare",
  STALLION: "stallion",
  GELDING: "gelding",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ");
