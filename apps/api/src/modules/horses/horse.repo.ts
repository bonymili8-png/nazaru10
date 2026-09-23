import type { Attributes, Genome, HorseStatus, Rarity, Sex } from "@thoroughline/engine";
import { type Queryable, row, rows } from "../../common/db.js";
import { notFound } from "../../common/errors.js";

export interface HorseRow {
  id: string;
  name: string;
  sex: Sex;
  birth_at: Date;
  owner_id: string | null;
  stable_id: string | null;
  is_house: boolean;
  house_class: string | null;
  sale_price: number | null;
  sire_id: string | null;
  dam_id: string | null;
  generation: number;
  genome: Genome;
  attributes: Attributes;
  rarity: Rarity;
  bloodline: string;
  coat: string;
  status: HorseStatus;
  fatigue: number;
  health: number;
  form: number;
  condition_updated_at: Date;
  injured_until: Date | null;
  ability_rating: number;
  race_rating: number;
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  earnings: number;
  diagnosed_at: Date | null;
  created_at: Date;
  retired_at: Date | null;
}

export interface NewHorse {
  name: string;
  sex: Sex;
  birthAt: Date;
  ownerId: string | null;
  stableId: string | null;
  isHouse: boolean;
  houseClass?: string | null;
  salePrice?: number | null;
  genome: Genome;
  attributes: Attributes;
  abilityRating: number;
  raceRating: number;
  now: Date;
}

export async function insertHorse(c: Queryable, h: NewHorse): Promise<HorseRow> {
  const r = await row<HorseRow>(
    c,
    `INSERT INTO horses (name, sex, birth_at, owner_id, stable_id, is_house, house_class, sale_price, genome, attributes,
                         rarity, bloodline, coat, ability_rating, race_rating, condition_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [
      h.name,
      h.sex,
      h.birthAt,
      h.ownerId,
      h.stableId,
      h.isHouse,
      h.houseClass ?? null,
      h.salePrice ?? null,
      JSON.stringify(h.genome),
      JSON.stringify(h.attributes),
      h.genome.rarity,
      h.genome.bloodline,
      h.genome.coat,
      h.abilityRating,
      h.raceRating,
      h.now,
    ],
  );
  return r!;
}

export async function getHorse(c: Queryable, id: string, lock = false): Promise<HorseRow> {
  const r = await row<HorseRow>(c, `SELECT * FROM horses WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  if (!r) throw notFound("Horse");
  return r;
}

export const horsesByOwner = (c: Queryable, ownerId: string) =>
  rows<HorseRow>(c, "SELECT * FROM horses WHERE owner_id = $1 AND retired_at IS NULL ORDER BY created_at", [
    ownerId,
  ]);

export async function recordOwnership(
  c: Queryable,
  horseId: string,
  from: string | null,
  to: string | null,
  reason: string,
  price: number | null = null,
): Promise<void> {
  await c.query(
    "INSERT INTO horse_ownership_history (horse_id, from_owner_id, to_owner_id, reason, price) VALUES ($1,$2,$3,$4,$5)",
    [horseId, from, to, reason, price],
  );
}

/**
 * Move a horse to a new owner (caller holds the horse row lock). Clears house/sale flags,
 * resets status to IDLE and appends the ownership history.
 */
export async function transferHorse(
  c: Queryable,
  h: Pick<HorseRow, "id" | "owner_id">,
  to: { userId: string; stableId: string },
  reason: string,
  price: number | null,
  now: Date,
): Promise<HorseRow> {
  const res = await c.query<HorseRow>(
    `UPDATE horses SET owner_id = $2, stable_id = $3, is_house = false, house_class = NULL, sale_price = NULL,
            status = 'IDLE', updated_at = $4 WHERE id = $1 RETURNING *`,
    [h.id, to.userId, to.stableId, now],
  );
  await recordOwnership(c, h.id, h.owner_id, to.userId, reason, price);
  return res.rows[0]!;
}
