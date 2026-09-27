import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  ClubDetailDto,
  ClubMemberDto,
  ClubRole,
  ClubSummaryDto,
  CreateClubRequest,
  Crest,
  MyClubDto,
} from "@thoroughline/contracts";
import { seasonAt } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db, type Queryable, row, rows } from "../../common/db.js";
import { conflict, forbidden, notFound } from "../../common/errors.js";
import { AuditService, EventsService } from "../../common/events.js";
import { GameConfigService } from "../../common/game-config.js";
import { memberSql } from "../../common/membership.js";
import { LedgerService } from "../economy/ledger.service.js";

interface ClubRow {
  id: string;
  name: string;
  tag: string;
  description: string;
  owner_id: string;
  members: number;
  points: number;
  level: number;
  chat_url: string | null;
}

/**
 * Clubs: groups of up to `maxMembers` players, ranked by the sum of their members' season
 * points. One club per player; leaving starts a cooldown before joining another. When the owner
 * leaves, the longest-serving member takes over; the last one out disbands the club.
 */
@Injectable()
export class ClubsService {
  constructor(
    private readonly db: Db,
    private readonly config: GameConfigService,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private get cfg() {
    return this.config.get().clubs;
  }

  private season(): number {
    return seasonAt(this.clock.now(), this.config.get()).season;
  }

  /** Active clubs with member counts and this season's points, best first. */
  private async ranked(c: Queryable, filter = "", params: unknown[] = []): Promise<ClubRow[]> {
    return rows<ClubRow>(
      c,
      `SELECT k.id, k.name, k.tag, k.description, k.owner_id, k.level, k.chat_url,
              (SELECT count(*)::int FROM club_members m WHERE m.club_id = k.id) AS members,
              COALESCE((SELECT sum(p.points)::int FROM club_members m
                          JOIN season_points p ON p.owner_id = m.user_id AND p.season = $1
                         WHERE m.club_id = k.id), 0) AS points
         FROM clubs k WHERE k.disbanded_at IS NULL ${filter}
        ORDER BY points DESC, members DESC, k.created_at`,
      [this.season(), ...params],
    );
  }

  /** Member cap for a club level. */
  maxMembers(level: number): number {
    return this.cfg.levelMaxMembers[level - 1] ?? this.cfg.levelMaxMembers.at(-1) ?? this.cfg.maxMembers;
  }

  private async treasury(c: Queryable, clubId: string): Promise<number> {
    const r = await row<{ balance: string }>(
      c,
      "SELECT balance FROM accounts WHERE owner_type = 'CLUB' AND code = $1 AND currency = 'CREDITS'",
      [clubId],
    );
    return r ? Number(r.balance) : 0;
  }

  /** Donate credits to the viewer's club treasury (members only; one-way, never withdrawn). */
  async donate(userId: string, amount: number): Promise<ClubDetailDto> {
    if (amount < this.cfg.minDonation)
      throw conflict("DONATION_TOO_SMALL", `Donate at least ${this.cfg.minDonation} credits`);
    const now = this.clock.now();
    const clubId = await this.db.tx(async (c) => {
      const m = await row<{ club_id: string }>(c, "SELECT club_id FROM club_members WHERE user_id = $1", [
        userId,
      ]);
      if (!m) throw conflict("NOT_IN_CLUB", "Join a club first");
      await this.ledger.post(c, {
        idempotencyKey: `club:${m.club_id}:donation:${userId}:${now.getTime()}`,
        type: "CLUB_DONATION",
        reason: "Club treasury donation",
        actorId: userId,
        metadata: { clubId: m.club_id },
        entries: [
          { account: { user: userId, currency: "CREDITS" }, amount: -amount },
          { account: { club: m.club_id, currency: "CREDITS" }, amount },
        ],
      });
      await this.events.emit(c, {
        type: "club_donation",
        aggregateType: "club",
        aggregateId: m.club_id,
        actorId: userId,
        payload: { amount },
      });
      return m.club_id;
    });
    return this.detail(clubId, userId);
  }

  /** The owner spends the treasury on the next club level (more members). */
  async upgrade(ownerId: string): Promise<ClubDetailDto> {
    const clubId = await this.db.tx(async (c) => {
      const k = await row<{ id: string; level: number; owner_id: string }>(
        c,
        `SELECT k.id, k.level, k.owner_id FROM clubs k JOIN club_members m ON m.club_id = k.id
          WHERE m.user_id = $1 AND k.disbanded_at IS NULL FOR UPDATE OF k`,
        [ownerId],
      );
      if (!k) throw conflict("NOT_IN_CLUB", "Join a club first");
      if (k.owner_id !== ownerId) throw forbidden("Only the club owner can upgrade the club");
      const cost = this.cfg.upgradeCosts[k.level - 1];
      if (cost === undefined) throw conflict("MAX_LEVEL", "The club is at its highest level");
      await this.ledger.post(c, {
        idempotencyKey: `club:${k.id}:level:${k.level + 1}`,
        type: "CLUB_UPGRADE",
        reason: `Club level ${k.level + 1}`,
        actorId: ownerId,
        metadata: { clubId: k.id, level: k.level + 1 },
        entries: [
          { account: { club: k.id, currency: "CREDITS" }, amount: -cost },
          { account: { system: "CLUBS", currency: "CREDITS" }, amount: cost },
        ],
      });
      await c.query("UPDATE clubs SET level = level + 1 WHERE id = $1", [k.id]);
      await this.events.emit(c, {
        type: "club_upgraded",
        aggregateType: "club",
        aggregateId: k.id,
        actorId: ownerId,
        payload: { level: k.level + 1, cost },
      });
      return k.id;
    });
    return this.detail(clubId, ownerId);
  }

  /** The owner sets (or clears) the club's Telegram group link, shown to members only. */
  async setChat(ownerId: string, url: string | null): Promise<ClubDetailDto> {
    const k = await row<{ id: string }>(
      this.db.pool,
      "UPDATE clubs SET chat_url = $2 WHERE owner_id = $1 AND disbanded_at IS NULL RETURNING id",
      [ownerId, url],
    );
    if (!k) throw forbidden("Only the club owner can set the chat link");
    return this.detail(k.id, ownerId);
  }

  private summary(k: ClubRow, rank: number | null): ClubSummaryDto {
    return {
      id: k.id,
      name: k.name,
      tag: k.tag,
      description: k.description,
      members: k.members,
      maxMembers: this.maxMembers(k.level),
      points: k.points,
      rank: k.points > 0 ? rank : null,
    };
  }

  async list(q: string | undefined, limit: number): Promise<ClubSummaryDto[]> {
    const all = await this.ranked(this.db.pool);
    const rankOf = new Map(all.filter((k) => k.points > 0).map((k, i) => [k.id, i + 1]));
    const needle = q?.toLowerCase();
    return all
      .filter((k) => !needle || k.name.toLowerCase().includes(needle) || k.tag.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((k) => this.summary(k, rankOf.get(k.id) ?? null));
  }

  private cooldownUntil(leftAt: Date | null): Date | null {
    if (!leftAt) return null;
    const until = new Date(leftAt.getTime() + this.cfg.rejoinCooldownHours * 3_600_000);
    return until > this.clock.now() ? until : null;
  }

  async mine(userId: string): Promise<MyClubDto> {
    const u = await this.db.one<{ club_id: string | null; club_left_at: Date | null }>(
      `SELECT m.club_id, u.club_left_at FROM users u LEFT JOIN club_members m ON m.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    return {
      clubId: u?.club_id ?? null,
      createCost: this.cfg.createCost,
      cooldownUntil: this.cooldownUntil(u?.club_left_at ?? null)?.toISOString() ?? null,
    };
  }

  async detail(clubId: string, viewerId: string): Promise<ClubDetailDto> {
    const all = await this.ranked(this.db.pool);
    const k = all.find((x) => x.id === clubId);
    if (!k) throw notFound("Club");
    const rank = all.filter((x) => x.points > 0).findIndex((x) => x.id === clubId);
    const season = this.season();
    const members = await this.db.query<{
      user_id: string;
      name: string;
      stable_name: string;
      crest: Crest;
      member: boolean;
      role: ClubRole;
      points: number;
      joined_at: Date;
    }>(
      `SELECT m.user_id, COALESCE(u.first_name, u.username, 'Owner') AS name, s.name AS stable_name, s.crest,
              ${memberSql("m.user_id", "$3")} AS member, m.role, COALESCE((SELECT sum(points)::int FROM season_points p
                                 WHERE p.owner_id = m.user_id AND p.season = $2), 0) AS points, m.joined_at
         FROM club_members m JOIN users u ON u.id = m.user_id JOIN stables s ON s.owner_id = m.user_id
        WHERE m.club_id = $1 ORDER BY points DESC, m.joined_at`,
      [clubId, season, this.clock.now()],
    );
    const me = await this.mine(viewerId);
    const myRole = members.find((m) => m.user_id === viewerId)?.role ?? null;
    const joinBlocked: ClubDetailDto["joinBlocked"] = myRole
      ? null
      : me.clubId
        ? "IN_CLUB"
        : me.cooldownUntil
          ? "COOLDOWN"
          : k.members >= this.maxMembers(k.level)
            ? "FULL"
            : null;
    const member = myRole !== null;
    return {
      ...this.summary(k, rank >= 0 ? rank + 1 : null),
      season,
      memberList: members.map((m): ClubMemberDto => ({
        userId: m.user_id,
        name: m.name,
        stableName: m.stable_name,
        crest: m.crest,
        member: m.member,
        role: m.role,
        points: m.points,
        joinedAt: m.joined_at.toISOString(),
      })),
      myRole,
      level: k.level,
      treasury: member ? await this.treasury(this.db.pool, k.id) : null,
      nextLevelCost: this.cfg.upgradeCosts[k.level - 1] ?? null,
      minDonation: this.cfg.minDonation,
      chatUrl: member ? k.chat_url : null,
      joinBlocked,
      cooldownUntil: joinBlocked === "COOLDOWN" ? me.cooldownUntil : null,
    };
  }

  async create(userId: string, req: CreateClubRequest): Promise<ClubDetailDto> {
    const now = this.clock.now();
    const id = randomUUID();
    await this.db.tx(async (c) => {
      await this.assertCanJoin(c, userId, now);
      try {
        await c.query("SAVEPOINT club_insert");
        await c.query(
          "INSERT INTO clubs (id, name, tag, description, owner_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
          [id, req.name, req.tag, req.description, userId, now],
        );
      } catch (err) {
        await c.query("ROLLBACK TO SAVEPOINT club_insert");
        const e = err as { code?: string; constraint?: string };
        if (e.code === "23505")
          throw conflict(
            e.constraint === "clubs_active_tag" ? "CLUB_TAG_TAKEN" : "CLUB_NAME_TAKEN",
            e.constraint === "clubs_active_tag" ? "That tag is taken" : "That name is taken",
          );
        throw err;
      }
      await c.query(
        "INSERT INTO club_members (user_id, club_id, role, joined_at) VALUES ($1,$2,'OWNER',$3)",
        [userId, id, now],
      );
      await this.ledger.debit(c, {
        userId,
        currency: "CREDITS",
        amount: this.cfg.createCost,
        sink: "CLUBS",
        key: `club:create:${id}`,
        type: "CLUB_CREATE",
        reason: `Founded club ${req.name}`,
        metadata: { clubId: id },
      });
      await this.events.emit(c, {
        type: "club_created",
        aggregateType: "club",
        aggregateId: id,
        actorId: userId,
        payload: { name: req.name, tag: req.tag },
      });
    });
    return this.detail(id, userId);
  }

  async join(userId: string, clubId: string): Promise<ClubDetailDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      // Lock the club so concurrent joins cannot overfill it.
      const k = await row<{ id: string; level: number }>(
        c,
        "SELECT id, level FROM clubs WHERE id = $1 AND disbanded_at IS NULL FOR UPDATE",
        [clubId],
      );
      if (!k) throw notFound("Club");
      await this.assertCanJoin(c, userId, now);
      const n = await row<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM club_members WHERE club_id = $1",
        [clubId],
      );
      if (n!.n >= this.maxMembers(k.level)) throw conflict("CLUB_FULL", "This club is full");
      await c.query(
        "INSERT INTO club_members (user_id, club_id, role, joined_at) VALUES ($1,$2,'MEMBER',$3)",
        [userId, clubId, now],
      );
    });
    return this.detail(clubId, userId);
  }

  async leave(userId: string): Promise<MyClubDto> {
    const now = this.clock.now();
    await this.db.tx(async (c) => {
      const m = await row<{ club_id: string; role: ClubRole }>(
        c,
        "SELECT club_id, role FROM club_members WHERE user_id = $1",
        [userId],
      );
      if (!m) throw conflict("NOT_IN_CLUB", "You are not in a club");
      await c.query("SELECT id FROM clubs WHERE id = $1 FOR UPDATE", [m.club_id]);
      await c.query("DELETE FROM club_members WHERE user_id = $1", [userId]);
      await c.query("UPDATE users SET club_left_at = $2 WHERE id = $1", [userId, now]);
      if (m.role === "OWNER") {
        const heir = await row<{ user_id: string }>(
          c,
          "SELECT user_id FROM club_members WHERE club_id = $1 ORDER BY joined_at, user_id LIMIT 1",
          [m.club_id],
        );
        if (heir) {
          await c.query("UPDATE club_members SET role = 'OWNER' WHERE user_id = $1", [heir.user_id]);
          await c.query("UPDATE clubs SET owner_id = $2 WHERE id = $1", [m.club_id, heir.user_id]);
        } else {
          await c.query("UPDATE clubs SET disbanded_at = $2 WHERE id = $1", [m.club_id, now]);
        }
      }
    });
    return this.mine(userId);
  }

  /** The owner removes a member (no cooldown for the removed player). */
  async kick(ownerId: string, targetId: string, ip: string): Promise<ClubDetailDto> {
    const clubId = await this.db.tx(async (c) => {
      const me = await row<{ club_id: string; role: ClubRole }>(
        c,
        "SELECT club_id, role FROM club_members WHERE user_id = $1",
        [ownerId],
      );
      if (!me || me.role !== "OWNER") throw forbidden();
      if (targetId === ownerId) throw conflict("SELF_ACTION", "Leave the club instead");
      const r = await c.query("DELETE FROM club_members WHERE user_id = $1 AND club_id = $2", [
        targetId,
        me.club_id,
      ]);
      if (r.rowCount === 0) throw notFound("Member");
      await this.audit.log(c, {
        actorId: ownerId,
        action: "CLUB_KICK",
        targetType: "user",
        targetId,
        before: { clubId: me.club_id },
        after: null,
        reason: "club owner removed member",
        ip,
      });
      return me.club_id;
    });
    return this.detail(clubId, ownerId);
  }

  private async assertCanJoin(c: Queryable, userId: string, now: Date): Promise<void> {
    const u = await row<{ in_club: boolean; club_left_at: Date | null }>(
      c,
      `SELECT EXISTS (SELECT 1 FROM club_members WHERE user_id = $1) AS in_club, club_left_at FROM users WHERE id = $1`,
      [userId],
    );
    if (u!.in_club) throw conflict("ALREADY_IN_CLUB", "Leave your current club first");
    const until = u!.club_left_at
      ? new Date(u!.club_left_at.getTime() + this.cfg.rejoinCooldownHours * 3_600_000)
      : null;
    if (until && until > now)
      throw conflict("CLUB_COOLDOWN", "You recently left a club", { until: until.toISOString() });
  }
}
