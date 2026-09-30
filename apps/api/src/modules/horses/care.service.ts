import { Injectable } from "@nestjs/common";
import type { CareRoundDto } from "@thoroughline/contracts";
import { bondNow, type CareAction, careAvailability, clamp } from "@thoroughline/engine";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { conflict } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { horsesByOwner, type HorseRow } from "./horse.repo.js";
import { HorsesService } from "./horses.service.js";

const BLOCK_MESSAGES: Record<string, string> = {
  COOLDOWN: "Already done recently — the horse needs a break from it",
  NO_RECENT_RACE: "Cold hosing is for the legs right after a race",
  ALREADY_HOSED: "Its legs were already hosed after this race",
  SHOES_FRESH: "Its shoes are fresh — no need for the farrier yet",
  BUSY: "The horse is away training",
  RETIRED: "The horse is retired",
};

/**
 * Daily care between starts: free actions (the owner's time) on per-horse cooldowns. Rules
 * live in the engine (care/index.ts); this service applies them to a locked horse row.
 */
@Injectable()
export class CareService {
  constructor(
    private readonly db: Db,
    private readonly horses: HorsesService,
    private readonly config: GameConfigService,
    private readonly clock: Clock,
  ) {}

  async perform(userId: string, horseId: string, action: CareAction): Promise<HorseRow> {
    const now = this.clock.now();
    const cfg = this.config.get();
    const a = cfg.care.actions[action];
    return this.db.tx(async (c) => {
      // Fold the condition to now first, so a fatigue relief applies to today's fatigue.
      const h = await this.horses.normalize(c, await this.horses.lockOwned(c, horseId, userId), now);
      if (h.status === "TRAINING") throw conflict("BUSY", BLOCK_MESSAGES.BUSY!);
      if (h.status === "RETIRED") throw conflict("RETIRED", BLOCK_MESSAGES.RETIRED!);
      const { block } = careAvailability(action, this.horses.careState(h), now, cfg);
      if (block) throw conflict(block, BLOCK_MESSAGES[block] ?? block);
      const bond = clamp(bondNow(h.bond, h.bond_at, now, cfg) + a.bond, 0, cfg.care.bondMax);
      const res = await c.query<HorseRow>(
        `UPDATE horses SET
            bond = $3, bond_at = $2,
            care_last = care_last || jsonb_build_object($4::text, $2::timestamptz),
            fatigue = GREATEST(0, fatigue - $5),
            hosed_last_race = hosed_last_race OR $6,
            massaged = massaged OR $7,
            shoe_starts = CASE WHEN $8 THEN 0 ELSE shoe_starts END,
            updated_at = $2
          WHERE id = $1 RETURNING *`,
        [
          h.id,
          now,
          bond,
          action,
          a.fatigueRelief ?? 0,
          action === "COLD_HOSE",
          action === "MASSAGE",
          action === "FARRIER",
        ],
      );
      return res.rows[0]!;
    });
  }

  /** The stable round: each horse with the care it can have right now. */
  async round(userId: string): Promise<CareRoundDto> {
    const now = this.clock.now();
    const list = await horsesByOwner(this.db.pool, userId);
    return {
      horses: list
        .filter((h) => h.status !== "RETIRED")
        .map((h) => {
          const care = this.horses.careDto(h, now);
          return {
            horseId: h.id,
            name: h.name,
            bond: care.bond,
            ready: care.actions.filter((x) => x.ready).map((x) => x.action),
          };
        }),
    };
  }
}
