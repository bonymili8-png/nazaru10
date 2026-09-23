export const TRAINABLE_ATTRIBUTES = [
  "speed",
  "acceleration",
  "stamina",
  "endurance",
  "strength",
  "agility",
  "start",
  "cornering",
  "finalKick",
  "focus",
] as const;
export type TrainableAttribute = (typeof TRAINABLE_ATTRIBUTES)[number];
export type Attributes = Record<TrainableAttribute, number>;

export const TRAITS = ["temperament", "courage", "consistency", "drive", "stressResistance"] as const;
export type Trait = (typeof TRAITS)[number];
export type Traits = Record<Trait, number>;

export const SURFACES = ["TURF", "DIRT", "SYNTHETIC"] as const;
export type Surface = (typeof SURFACES)[number];

export interface Aptitudes {
  /** 0–100 affinity per surface; 50 is neutral. */
  surface: Record<Surface, number>;
  /** 0–100 ability on soft/heavy/muddy going. */
  wet: number;
  /** Distance in metres the horse is built for. */
  optimalDistance: number;
  /** 0–100 flexibility around the optimal distance. */
  distanceRange: number;
}

export interface HiddenGenes {
  /** Multiplier on injury probability, 0.5–1.5. */
  injurySusceptibility: number;
  /** −1 early developer … +1 late developer (shifts peak age). */
  maturity: number;
  /** 0–100 tactical sense: positioning, reacting to gaps. */
  raceIntelligence: number;
  /** 0–100 how quickly aptitudes reveal / adapt (reserved for P2). */
  adaptability: number;
}

export const RARITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as const;
export type Rarity = (typeof RARITIES)[number];

export const SEXES = ["COLT", "FILLY", "STALLION", "MARE", "GELDING"] as const;
export type Sex = (typeof SEXES)[number];

export const COATS = [
  "BAY",
  "DARK_BAY",
  "CHESTNUT",
  "GREY",
  "BLACK",
  "ROAN",
  "PALOMINO",
  "DAPPLE_GREY",
] as const;
export type Coat = (typeof COATS)[number];

/** Immutable genetic make-up of a horse. */
export interface Genome {
  /** Maximum reachable value of each trainable attribute (hidden "potential"). */
  ceilings: Attributes;
  traits: Traits;
  aptitudes: Aptitudes;
  hidden: HiddenGenes;
  coat: Coat;
  rarity: Rarity;
  /** Bloodline label inherited through the sire line. */
  bloodline: string;
}

export interface Condition {
  /** 0 (fresh) – 100 (exhausted). */
  fatigue: number;
  /** 0–100. */
  health: number;
  /** −1 … +1 recent-performance momentum. */
  form: number;
}

export const HORSE_STATUSES = [
  "IDLE",
  "TRAINING",
  "ENTERED",
  "RACING",
  "INJURED",
  "LISTED",
  "BREEDING",
  "RETIRED",
] as const;
export type HorseStatus = (typeof HORSE_STATUSES)[number];
