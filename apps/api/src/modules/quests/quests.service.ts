import { Injectable } from "@nestjs/common";
import type { QuestDto } from "@thoroughline/contracts";
import { Db, type Queryable, rows } from "../../common/db.js";
import { conflict, notFound } from "../../common/errors.js";
import { EventsService } from "../../common/events.js";
import { LedgerService } from "../economy/ledger.service.js";
import { QUESTS, questByCode } from "./quests.js";

@Injectable()
export class QuestsService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
  ) {}

  /** Mark a quest completed (idempotent). Call inside the transaction that achieved it. */
  async complete(c: Queryable, userId: string, code: string, now: Date): Promise<void> {
    if (!questByCode(code)) throw new Error(`unknown quest ${code}`);
    const r = await c.query(
      `INSERT INTO user_quests (user_id, quest_code, completed_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, quest_code) DO UPDATE SET completed_at = COALESCE(user_quests.completed_at, EXCLUDED.completed_at)
       RETURNING (xmax = 0) AS inserted`,
      [userId, code, now],
    );
    if ((r.rows[0] as { inserted: boolean } | undefined)?.inserted) {
      await this.events.emit(c, {
        type: "quest_completed",
        aggregateType: "user",
        aggregateId: userId,
        actorId: userId,
        payload: { code },
      });
    }
  }

  async list(userId: string, c: Queryable = this.db.pool): Promise<QuestDto[]> {
    const state = new Map(
      (
        await rows<{ quest_code: string; completed_at: Date | null; claimed_at: Date | null }>(
          c,
          "SELECT quest_code, completed_at, claimed_at FROM user_quests WHERE user_id = $1",
          [userId],
        )
      ).map((r) => [r.quest_code, r] as const),
    );
    return QUESTS.map((q) => ({
      code: q.code,
      title: q.title,
      description: q.description,
      chapter: q.chapter,
      reward: q.reward,
      completed: !!state.get(q.code)?.completed_at,
      claimed: !!state.get(q.code)?.claimed_at,
    }));
  }

  async claim(userId: string, code: string, now: Date): Promise<QuestDto[]> {
    const q = questByCode(code);
    if (!q) throw notFound("Quest");
    await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE user_quests SET claimed_at = $3
          WHERE user_id = $1 AND quest_code = $2 AND completed_at IS NOT NULL AND claimed_at IS NULL`,
        [userId, code, now],
      );
      if (r.rowCount !== 1)
        throw conflict("QUEST_NOT_CLAIMABLE", "Quest is not completed or already claimed");
      const grants: [keyof QuestDto["reward"], "CREDITS" | "GEMS" | "REPUTATION"][] = [
        ["credits", "CREDITS"],
        ["gems", "GEMS"],
        ["reputation", "REPUTATION"],
      ];
      for (const [field, currency] of grants) {
        const amount = q.reward[field];
        if (!amount) continue;
        await this.ledger.credit(c, {
          userId,
          currency,
          amount,
          source: "QUEST_REWARD",
          key: `quest:${userId}:${code}:${currency}`,
          type: "QUEST_REWARD",
          reason: q.title,
        });
      }
    });
    return this.list(userId);
  }
}
