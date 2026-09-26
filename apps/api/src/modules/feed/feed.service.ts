import { Injectable } from "@nestjs/common";
import type { FeedItemDto, FeedKind } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, row } from "../../common/db.js";

/** A market sale at or above this price makes the news. */
export const BIG_SALE = 20_000;
const RETENTION_DAYS = 30;

interface EventRow {
  id: number;
  type: string;
  actor_id: string | null;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

type Item = { kind: FeedKind; actorId: string | null; payload: Record<string, unknown> };

/**
 * Racing news: a read model over the domain-event log. A cursor (locked while reading) makes
 * ingestion safe with several workers; items are keyed by event id so nothing is added twice.
 * Only public, bragging-worthy moments are kept, never private details (no prices paid to the
 * game, no training, no injuries).
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private toItem(e: EventRow): Item | null {
    const p = e.payload;
    const user = (typeof p.userId === "string" ? p.userId : e.actor_id) ?? null;
    switch (e.type) {
      case "race_result":
        return Number(p.position) === 1
          ? {
              kind: "WIN",
              actorId: user,
              payload: {
                horseName: p.horseName,
                horseId: p.horseId,
                raceName: p.raceName,
                raceId: p.raceId,
                field: p.field,
              },
            }
          : null;
      case "tournament_champion":
        return {
          kind: "CHAMPION",
          actorId: user,
          payload: { horseName: p.horseName, tournamentName: p.tournamentName, tier: p.tier },
        };
      case "market_sale_completed":
        return Number(p.price) >= BIG_SALE
          ? {
              kind: "BIG_SALE",
              actorId: typeof p.buyerId === "string" ? p.buyerId : null,
              payload: { horseName: p.horseName, horseId: p.horseId, price: p.price },
            }
          : null;
      case "foal_delivered":
        return p.mutation
          ? {
              kind: "FOAL",
              actorId: user,
              payload: { foalName: p.foalName, foalId: p.foalId, sireName: p.sireName, damName: p.damName },
            }
          : null;
      case "season_reward":
        return Number(p.rank) <= 3
          ? {
              kind: "SEASON_TOP",
              actorId: user,
              payload: { season: p.season, rank: p.rank, points: p.points },
            }
          : null;
      case "club_created":
        return {
          kind: "CLUB_CREATED",
          actorId: e.actor_id,
          payload: { clubName: p.name, tag: p.tag, clubId: e.aggregate_id },
        };
      default:
        return null;
    }
  }

  /** Read new domain events into the feed. Returns the number of items added. */
  async ingest(batch = 500): Promise<number> {
    return this.db.tx(async (c) => {
      const cur = await row<{ last_id: number }>(
        c,
        "SELECT last_id FROM feed_cursor WHERE id = 1 FOR UPDATE SKIP LOCKED",
      );
      if (!cur) return 0; // another worker is ingesting
      const events = await c.query<EventRow>(
        `SELECT id, type, actor_id, aggregate_id, payload, created_at FROM domain_events
          WHERE id > $1 ORDER BY id LIMIT $2`,
        [cur.last_id, batch],
      );
      if (events.rows.length === 0) return 0;
      let added = 0;
      for (const e of events.rows) {
        const item = this.toItem(e);
        if (!item) continue;
        const r = await c.query(
          `INSERT INTO feed_items (event_id, kind, actor_id, payload, created_at) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (event_id) DO NOTHING`,
          [e.id, item.kind, item.actorId, JSON.stringify(item.payload), e.created_at],
        );
        added += r.rowCount ?? 0;
      }
      await c.query("UPDATE feed_cursor SET last_id = $1 WHERE id = 1", [events.rows.at(-1)!.id]);
      return added;
    });
  }

  async prune(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - RETENTION_DAYS * 86_400_000);
    const r = await this.db.query("DELETE FROM feed_items WHERE created_at < $1 RETURNING id", [cutoff]);
    return r.length;
  }

  /** Latest items for everyone, or only those by members of the viewer's club. */
  async list(viewerId: string, scope: "all" | "club", limit: number): Promise<FeedItemDto[]> {
    const rows = await this.db.query<{
      id: number;
      kind: FeedKind;
      actor_id: string | null;
      actor_name: string | null;
      payload: Record<string, string | number>;
      created_at: Date;
    }>(
      `SELECT f.id, f.kind, f.actor_id, COALESCE(u.first_name, u.username) AS actor_name, f.payload, f.created_at
         FROM feed_items f LEFT JOIN users u ON u.id = f.actor_id
        WHERE (u.id IS NULL OR u.status = 'ACTIVE')
          AND ($2::text = 'all' OR f.actor_id IN (
                SELECT m.user_id FROM club_members m
                 WHERE m.club_id = (SELECT club_id FROM club_members WHERE user_id = $1)))
        ORDER BY f.id DESC LIMIT $3`,
      [viewerId, scope, limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      createdAt: r.created_at.toISOString(),
      actorId: r.actor_id,
      actorName: r.actor_name ?? "Owner",
      vars: r.payload,
      link: this.link(r.kind, r.payload),
    }));
  }

  private link(kind: FeedKind, p: Record<string, string | number>): string | null {
    if (kind === "WIN" && p.raceId) return `/race/?id=${p.raceId}`;
    if (kind === "BIG_SALE" && p.horseId) return `/horse/?id=${p.horseId}`;
    if (kind === "FOAL" && p.foalId) return `/horse/?id=${p.foalId}`;
    if (kind === "CLUB_CREATED" && p.clubId) return `/club/?id=${p.clubId}`;
    return null;
  }
}
