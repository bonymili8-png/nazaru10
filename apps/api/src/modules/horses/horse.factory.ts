import { Injectable } from "@nestjs/common";
import {
  abilityRating,
  birthDateForAge,
  generateGenome,
  generateHorseName,
  initialAttributes,
  Rng,
  type Rarity,
  type Sex,
} from "@thoroughline/engine";
import { randomUUID } from "node:crypto";
import type { Queryable } from "../../common/db.js";
import { GameConfigService } from "../../common/game-config.js";
import { type HorseRow, insertHorse } from "./horse.repo.js";

export interface GenerateHorseInput {
  quality: number;
  age: number;
  rarity?: Rarity;
  ownerId?: string | null;
  stableId?: string | null;
  isHouse: boolean;
  houseClass?: string | null;
  salePrice?: (row: { genome: HorseRow["genome"]; attributes: HorseRow["attributes"] }) => number;
  /** Deterministic seed (tests); defaults to a random UUID. */
  seed?: string;
  now: Date;
}

/** Creates freshly generated horses (starter, house/NPC, primary sales). */
@Injectable()
export class HorseFactory {
  constructor(private readonly config: GameConfigService) {}

  async generate(c: Queryable, input: GenerateHorseInput): Promise<HorseRow> {
    const cfg = this.config.get();
    const rng = new Rng(input.seed ?? randomUUID());
    const genome = generateGenome(rng, { quality: input.quality, rarity: input.rarity }, cfg);
    const attributes = initialAttributes(genome, input.age, rng);
    const male = rng.chance(0.55);
    const sex: Sex =
      input.age < 4 ? (male ? "COLT" : "FILLY") : male ? (rng.chance(0.4) ? "GELDING" : "STALLION") : "MARE";
    return insertHorse(c, {
      name: generateHorseName(rng),
      sex,
      birthAt: birthDateForAge(input.age, input.now, cfg),
      ownerId: input.ownerId ?? null,
      stableId: input.stableId ?? null,
      isHouse: input.isHouse,
      houseClass: input.houseClass ?? null,
      salePrice: input.salePrice ? input.salePrice({ genome, attributes }) : null,
      genome,
      attributes,
      abilityRating: abilityRating(attributes, genome.traits),
      raceRating: cfg.race.initialRating,
      now: input.now,
    });
  }
}
