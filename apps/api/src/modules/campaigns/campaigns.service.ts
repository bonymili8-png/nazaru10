import { createHmac, randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { CampaignDto, CampaignPlatform, CreateCampaignRequest } from "@thoroughline/contracts";
import { Clock } from "../../common/clock.js";
import { Db, row, rows } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { AuditService } from "../../common/events.js";
import { ENV, type Env } from "../../config/env.js";

interface CampaignRow {
  id: string;
  code: string;
  name: string;
  partner: string | null;
  platform: CampaignPlatform;
  note: string | null;
  created_at: Date;
  archived_at: Date | null;
  clicks: number;
  visitors: number;
  opened: number;
  new_players: number;
  first_race: number;
  returned: number;
  active7d: number;
  payers: number;
  stars: number;
}

/** No look-alike characters, so a code read aloud or retyped survives. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Campaign links for partners (group admins, authors): each has a code, a tracked link that
 * counts visits before opening the Mini App with `c_CODE`, and a funnel. Opens are recorded at
 * sign-in (onboarding); the funnel follows the new players a link brought in.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(actorId: string, req: CreateCampaignRequest, ip: string | null): Promise<CampaignDto> {
    const id = await this.db.tx(async (c) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code =
          req.code ?? Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
        const r = await row<{ id: string }>(
          c,
          `INSERT INTO campaigns (code, name, partner, platform, note, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (code) DO NOTHING RETURNING id`,
          [code, req.name, req.partner || null, req.platform, req.note || null, actorId, this.clock.now()],
        );
        if (r) {
          await this.audit.log(c, {
            actorId,
            action: "CAMPAIGN_CREATE",
            targetType: "campaign",
            targetId: r.id,
            before: {},
            after: { code, name: req.name, partner: req.partner ?? null, platform: req.platform },
            reason: req.note ?? "campaign link",
            ip,
          });
          return r.id;
        }
        if (req.code) throw conflict("CODE_TAKEN", "That code is already used by another link");
      }
      throw conflict("TRY_AGAIN", "Could not generate a code, try again");
    });
    return (await this.list({}, id))[0]!;
  }

  async setArchived(actorId: string, id: string, archived: boolean, ip: string | null): Promise<CampaignDto> {
    await this.db.tx(async (c) => {
      const r = await row<{ id: string }>(
        c,
        "UPDATE campaigns SET archived_at = $2 WHERE id = $1 RETURNING id",
        [id, archived ? this.clock.now() : null],
      );
      if (!r) throw notFound("Campaign");
      await this.audit.log(c, {
        actorId,
        action: archived ? "CAMPAIGN_ARCHIVE" : "CAMPAIGN_RESTORE",
        targetType: "campaign",
        targetId: id,
        before: {},
        after: { archived },
        reason: archived ? "archived" : "restored",
        ip,
      });
    });
    return (await this.list({}, id))[0]!;
  }

  /**
   * Every link (or one) with its funnel. The period filters clicks and opens; what the new
   * players did afterwards (first race, coming back, buying) is counted to date.
   */
  async list(period: { from?: string; to?: string }, onlyId?: string): Promise<CampaignDto[]> {
    const now = this.clock.now();
    const from = period.from ? new Date(period.from) : new Date(0);
    const to = period.to ? new Date(period.to) : new Date(now.getTime() + 1000);
    const list = await rows<CampaignRow>(
      this.db.pool,
      `SELECT c.*,
              COALESCE(k.clicks, 0)::int AS clicks, COALESCE(k.visitors, 0)::int AS visitors,
              COALESCE(u.opened, 0)::int AS opened, COALESCE(u.new_players, 0)::int AS new_players,
              COALESCE(u.first_race, 0)::int AS first_race, COALESCE(u.returned, 0)::int AS returned,
              COALESCE(u.active7d, 0)::int AS active7d, COALESCE(u.payers, 0)::int AS payers,
              COALESCE(u.stars, 0)::int AS stars
         FROM campaigns c
         LEFT JOIN LATERAL (
           SELECT count(*) AS clicks, count(DISTINCT visitor) AS visitors
             FROM campaign_clicks WHERE campaign_id = c.id AND at >= $1 AND at < $2
         ) k ON true
         LEFT JOIN LATERAL (
           SELECT count(*) AS opened,
                  count(*) FILTER (WHERE cu.is_new) AS new_players,
                  count(*) FILTER (WHERE cu.is_new AND EXISTS (
                    SELECT 1 FROM race_entries e WHERE e.owner_id = cu.user_id AND e.status = 'RAN')) AS first_race,
                  count(*) FILTER (WHERE cu.is_new AND EXISTS (
                    SELECT 1 FROM user_activity a WHERE a.user_id = cu.user_id
                       AND a.day > (cu.opened_at AT TIME ZONE 'UTC')::date)) AS returned,
                  count(*) FILTER (WHERE cu.is_new AND EXISTS (
                    SELECT 1 FROM user_activity a WHERE a.user_id = cu.user_id
                       AND a.day >= ($3::timestamptz AT TIME ZONE 'UTC')::date - 6)) AS active7d,
                  count(*) FILTER (WHERE cu.is_new AND EXISTS (
                    SELECT 1 FROM payments p WHERE p.user_id = cu.user_id AND p.status = 'COMPLETED')) AS payers,
                  COALESCE(sum((SELECT COALESCE(sum(p.amount), 0) FROM payments p
                                 WHERE p.user_id = cu.user_id AND p.status = 'COMPLETED'))
                           FILTER (WHERE cu.is_new), 0) AS stars
             FROM campaign_users cu
            WHERE cu.campaign_id = c.id AND cu.opened_at >= $1 AND cu.opened_at < $2
         ) u ON true
        WHERE ($4::uuid IS NULL OR c.id = $4)
        ORDER BY (c.archived_at IS NULL) DESC, c.created_at DESC`,
      [from, to, now, onlyId ?? null],
    );
    return list.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      partner: r.partner,
      platform: r.platform,
      note: r.note,
      createdAt: r.created_at.toISOString(),
      archived: r.archived_at !== null,
      startParam: `c_${r.code}`,
      funnel: {
        clicks: r.clicks,
        visitors: r.visitors,
        opened: r.opened,
        newPlayers: r.new_players,
        firstRace: r.first_race,
        returned: r.returned,
        active7d: r.active7d,
        payers: r.payers,
        stars: r.stars,
      },
    }));
  }

  /** A visit to the tracked link (public). Unknown or archived codes are ignored. */
  async click(
    code: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ startParam: string } | null> {
    const c = code.toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(c)) return null;
    const visitor = createHmac("sha256", this.env.JWT_SECRET)
      .update(`campaign:${ip ?? "?"}:${userAgent ?? "?"}`)
      .digest("hex")
      .slice(0, 32);
    const r = await row<{ id: string }>(
      this.db.pool,
      `INSERT INTO campaign_clicks (campaign_id, visitor, at)
       SELECT id, $2, $3 FROM campaigns WHERE code = $1 AND archived_at IS NULL RETURNING campaign_id AS id`,
      [c, visitor, this.clock.now()],
    );
    return r ? { startParam: `c_${c}` } : null;
  }
}
