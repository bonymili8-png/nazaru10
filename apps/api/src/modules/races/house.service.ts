import { Injectable, type OnModuleInit } from "@nestjs/common";
import { type RaceClass, type Rng } from "@thoroughline/engine";
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
    const year = cfg.lifecycle.realDaysPerGameYear * 86_400_000;
    const maxBirth = new Date(now.getTime() - Math.max(ageLo, cfg.lifecycle.minRacingAge) * year);
    const minBirth = new Date(now.getTime() - ageHi * year);
    const found = await rows<HorseRow>(
      c,
      `SELECT * FROM horses
        WHERE is_house AND house_class = $1 AND status = 'IDLE' AND sale_price IS NULL
          AND birth_at BETWEEN $2 AND $3
        ORDER BY abs((genome->'aptitudes'->>'optimalDistance')::int - $5), condition_updated_at, id
        LIMIT $4 FOR UPDATE SKIP LOCKED`,
      [cls, minBirth, maxBirth, count, distance],
    );
    const [qLo, qHi] = cfg.race.classes[cls].houseQuality;
    while (found.length < count) {
      found.push(
        await this.factory.generate(c, {
          quality: rng.float(qLo, qHi),
          age: rng.float(Math.max(ageLo, cfg.lifecycle.minRacingAge), ageHi),
          isHouse: true,
          houseClass: cls,
          seed: `${rng.seed}/house/${found.length}/${rng.nextUint32()}`,
          now,
        }),
      );
    }
    return found;
  }
}
