import { Injectable } from "@nestjs/common";
import type { Queryable } from "./db.js";

export interface DomainEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

/** Writes to the transactional outbox (same transaction as the state change). */
@Injectable()
export class EventsService {
  async emit(c: Queryable, e: DomainEvent): Promise<void> {
    await c.query(
      "INSERT INTO domain_events (type, aggregate_type, aggregate_id, actor_id, payload) VALUES ($1, $2, $3, $4, $5)",
      [e.type, e.aggregateType, e.aggregateId, e.actorId ?? null, JSON.stringify(e.payload ?? {})],
    );
  }
}

@Injectable()
export class AuditService {
  async log(
    c: Queryable,
    entry: {
      actorId: string | null;
      action: string;
      targetType: string;
      targetId?: string | null;
      before?: unknown;
      after?: unknown;
      reason?: string | null;
      ip?: string | null;
    },
  ): Promise<void> {
    await c.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, before, after, reason, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.actorId,
        entry.action,
        entry.targetType,
        entry.targetId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.reason ?? null,
        entry.ip ?? null,
      ],
    );
  }
}
