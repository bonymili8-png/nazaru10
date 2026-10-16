import { Injectable } from "@nestjs/common";
import { defaultConfig } from "@thoroughline/engine";
import { Db, row, rows } from "./db.js";
import { AuditService } from "./events.js";
import { GameConfigService } from "./game-config.js";

/** One on/off change as the admin console lists it. */
export interface SwitchChange {
  enabled: boolean;
  at: string;
  by: string | null;
  note: string | null;
}

const getAt = (o: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined),
    o,
  );

/**
 * Admin on/off switches backed by game config: flipping one publishes a new config version
 * with only that boolean changed (the rest of the override is kept), audits it under its own
 * action and applies it live — the same path as any config publish.
 */
@Injectable()
export class ConfigSwitchService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly config: GameConfigService,
  ) {}

  /** Current value in the effective config. */
  get(path: readonly string[]): boolean {
    return getAt(this.config.get(), path) === true;
  }

  /** Returns whether anything changed (setting the current value publishes nothing). */
  async set(
    path: readonly string[],
    action: string,
    a: { actorId: string; enabled: boolean; note: string; ip: string | null },
  ): Promise<boolean> {
    const changed = await this.db.tx(async (c) => {
      const prev = await row<{ config: Record<string, unknown> | null }>(
        c,
        "SELECT config FROM game_config ORDER BY version DESC LIMIT 1 FOR UPDATE",
      );
      const override = structuredClone(prev?.config ?? {}) as Record<string, unknown>;
      const current = (getAt(override, path) ?? getAt(defaultConfig, path)) === true;
      if (current === a.enabled) return false;
      let node = override;
      for (const k of path.slice(0, -1)) {
        const next = node[k];
        node = node[k] = next && typeof next === "object" ? { ...(next as Record<string, unknown>) } : {};
      }
      node[path[path.length - 1]!] = a.enabled;
      const r = await rows<{ version: number }>(
        c,
        "INSERT INTO game_config (config, created_by, note) VALUES ($1, $2, $3) RETURNING version",
        [JSON.stringify(override), a.actorId, a.note],
      );
      await this.audit.log(c, {
        actorId: a.actorId,
        action,
        targetType: "game_config",
        targetId: String(r[0]!.version),
        before: { enabled: current },
        after: { enabled: a.enabled },
        reason: a.note,
        ip: a.ip,
      });
      return true;
    });
    if (changed) await this.config.refresh();
    return changed;
  }

  /** The last switch changes for an audit action, newest first. */
  async history(action: string, limit = 10): Promise<SwitchChange[]> {
    const list = await this.db.query<{
      after: { enabled: boolean } | null;
      created_at: Date;
      by: string | null;
      reason: string | null;
    }>(
      `SELECT a.after, a.created_at, a.reason, COALESCE(u.username, u.first_name) AS by
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.action = $1 ORDER BY a.id DESC LIMIT $2`,
      [action, limit],
    );
    return list.map((h) => ({
      enabled: !!h.after?.enabled,
      at: h.created_at.toISOString(),
      by: h.by,
      note: h.reason,
    }));
  }
}
