import { Injectable, type OnModuleInit } from "@nestjs/common";
import { houseRatingCap, projectCondition, type RaceClass, type Rng } from "@thoroughline/engine";
import { Db, type Queryable, rows } from "../../common/db.js";
import { GameConfigService } from "../../common/game-config.js";
import { HorseFactory } from "../horses/horse.factory.js";
import type { HorseRow } from "../horses/horse.repo.js";

const FIRST = [
  "Luca",
  "Maya",
  "Kenji",
  "Sofia",
  "Rory",
  "Amara",
  "Diego",
  "Ines",
  "Tomas",
  "Freya",
  "Omar",
  "Lena",
  "Ravi",
  "Chloe",
  "Nikolai",
  "Zara",
  "Hugo",
  "Ayla",
  "Mateo",
  "Elsa",
];
const LAST = [
  "Moreau",
  "Kavanagh",
  "Sato",
  "Delgado",
  "Byrne",
  "Okafor",
  "Lindqvist",
  "Rossi",
  "Hart",
  "Novak",
  "Fitzgerald",
  "Mendes",
  "Walsh",
  "Ivanova",
  "Park",
  "Quinn",
];

export interface JockeyRow {
  id: string;
  name: string;
  skill: number;
}

/** House (NPC) horses and jockeys that fill race fields so races always run. */
/** Condition a reused house horse needs to be picked for a field. */
/** house_class of house horses kept out of racing (retired sale horses, over-strong draws). */
export const OFF_POOL = "OFF";
const HOUSE_MAX_FATIGUE = 10;
const HOUSE_MIN_HEALTH = 90;

@Injectable()
export class HouseService implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly factory: HorseFactory,
    private readonly config: GameConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureJockeys();
  }

  /** Idempotently seed a pool of house jockeys spanning the skill range. */
  async ensureJockeys(count = 48): Promise<void> {
    const names: string[] = [];
    for (let i = 0; names.length < count; i++)
      names.push(`${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`);
    const skills = names.map((_, i) => Math.round((25 + (70 * i) / (count - 1)) * 100) / 100);
    await this.db.query(
      `INSERT INTO jockeys (name, skill) SELECT * FROM unnest($1::text[], $2::numeric[]) ON CONFLICT (name) DO NOTHING`,
      [names, skills],
    );
  }

  async pickJockeys(c: Queryable, cls: RaceClass, count: number, rng: Rng): Promise<JockeyRow[]> {
    const [lo, hi] = this.config.get().race.classes[cls].houseJockeySkill;
    let pool = await rows<JockeyRow>(
      c,
      "SELECT id, name, skill FROM jockeys WHERE is_house AND skill BETWEEN $1 AND $2 ORDER BY name",
      [lo, hi],
    );
    if (pool.length < count)
      pool = await rows<JockeyRow>(c, "SELECT id, name, skill FROM jockeys WHERE is_house ORDER BY name");
    return rng.shuffle(pool).slice(0, count);
  }

  /**
   * Lock `count` idle house horses of the class (generating new ones when the pool is short).
   * SKIP LOCKED lets concurrent race locks draw from the pool without blocking each other.
   */
  async fillers(
    c: Queryable,
    cls: RaceClass,
    count: number,
    distance: number,
    now: Date,
    rng: Rng,
  ): Promise<HorseRow[]> {
    if (count <= 0) return [];
    const cfg = this.config.get();
    // House horses stay within the class's age band (e.g. maidens are young horses).
    const [ageLo, ageHi] = cfg.race.classes[cls].houseAge;
    const cap = houseRatingCap(cls, cfg);
    const year = cfg.lifecycle.realDaysPerGameYear * 86_400_000;
    const maxBirth = new Date(now.getTime() - Math.max(ageLo, cfg.lifecycle.minRacingAge) * year);
    const minBirth = new Date(now.getTime() - ageHi * year);
    const candidates = await rows<HorseRow>(
      c,
      `SELECT * FROM horses
        WHERE is_house AND house_class = $1 AND status = 'IDLE' AND sale_price IS NULL
          AND birth_at BETWEEN $2 AND $3
          -- Cheap pre-filter at the fastest possible recovery rate (endurance 100), so it never
          -- drops a horse the exact check below would accept.
          AND fatigue - $7 * extract(epoch FROM ($6 - condition_updated_at)) / 3600 <= $8
          -- Never a rival stronger than the class's own house horses (see houseRatingCap).
          AND ability_rating <= $9
        ORDER BY abs((genome->'aptitudes'->>'optimalDistance')::int - $5), condition_updated_at, id
        LIMIT $4 FOR UPDATE SKIP LOCKED`,
      [
        cls,
        minBirth,
        maxBirth,
        count * 3,
        distance,
        now,
        cfg.condition.fatigueRecoveryPerHour * 1.1,
        HOUSE_MAX_FATIGUE,
        cap,
      ],
    );
    // Only rested house horses run: a tired filler would trail the field by dozens of lengths
    // (the economy simulation, which sets the class quality bands, assumes fresh house fields).
    const found = candidates
      .filter((h) => {
        const cond = projectCondition(
          { fatigue: h.fatigue, health: h.health, form: h.form, updatedAt: h.condition_updated_at },
          now,
          h.attributes.endurance,
          cfg,
        );
        return cond.fatigue <= HOUSE_MAX_FATIGUE && cond.health >= HOUSE_MIN_HEALTH;
      })
      .slice(0, count);
    const [qLo, qHi] = cfg.race.classes[cls].houseQuality;
    while (found.length < count) {
      // A fresh draw above the cap (≈ 5 %) is set aside off the racing pool and redrawn.
      for (let attempt = 0; ; attempt++) {
        const h = await this.factory.generate(c, {
          quality: rng.float(qLo, qHi),
          age: rng.float(Math.max(ageLo, cfg.lifecycle.minRacingAge), ageHi),
          isHouse: true,
          houseClass: cls,
          seed: `${rng.seed}/house/${found.length}/${rng.nextUint32()}`,
          now,
        });
        if (h.ability_rating <= cap || attempt >= 5) {
          found.push(h);
          break;
        }
        await c.query("UPDATE horses SET house_class = $2 WHERE id = $1", [h.id, OFF_POOL]);
      }
    }
    return found;
  }
}
