import type { Rarity, TrainableAttribute } from "../horse/types.js";

/**
 * Default game configuration. Every tunable number of the game lives here (and can be
 * overridden at runtime by the API from the `game_config` table). Keep this file the
 * single source of economy/balance constants — do not hard-code them elsewhere.
 */

export const TRAINING_TYPES = [
  "SPEED",
  "ACCELERATION",
  "STAMINA",
  "STRENGTH",
  "AGILITY",
  "STARTS",
  "FINISHING",
  "MENTAL",
  "TACTICAL",
  "RECOVERY",
] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

export const TRAINING_INTENSITIES = ["LIGHT", "NORMAL", "HARD"] as const;
export type TrainingIntensity = (typeof TRAINING_INTENSITIES)[number];

export const STRATEGIES = [
  "FRONT_RUNNER",
  "PACE_SETTER",
  "MID_PACK",
  "CLOSER",
  "CONSERVATIVE",
  "AGGRESSIVE",
] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const RACE_CLASSES = ["MAIDEN", "CLASS_5", "CLASS_4", "CLASS_3", "CLASS_2", "CLASS_1"] as const;
export type RaceClass = (typeof RACE_CLASSES)[number];

export interface TrainingTypeConfig {
  /** Relative gain weight per attribute. */
  weights: Partial<Record<TrainableAttribute, number>>;
  baseFatigue: number;
  /** Credits cost at NORMAL intensity. */
  cost: number;
  durationMinutes: number;
  /** Extra fatigue recovery granted (RECOVERY sessions). */
  fatigueRelief?: number;
  healthRelief?: number;
}

export interface RaceClassConfig {
  entryFee: number;
  purse: number;
  /** Inclusive race-rating band (null = open). */
  minRating: number | null;
  maxRating: number | null;
  maidenOnly: boolean;
  reputation: [number, number, number];
  /** Quality (0–1) of house horses generated to fill the field. */
  houseQuality: [number, number];
  houseJockeySkill: [number, number];
}

export interface GameConfig {
  lifecycle: {
    realDaysPerGameYear: number;
    minRacingAge: number;
    voluntaryRetireAge: number;
    forcedRetireAge: number;
    /** Training-response multiplier keyed by integer age in game years. */
    ageTrainingMultiplier: Record<number, number>;
  };
  condition: {
    fatigueRecoveryPerHour: number;
    healthRegenPerHour: number;
    formDecayPerDay: number;
    minHealthToRace: number;
    maxFatigueToRace: number;
    maxFatigueToTrain: number;
    minHealthToTrain: number;
  };
  training: {
    types: Record<TrainingType, TrainingTypeConfig>;
    intensity: Record<TrainingIntensity, { gain: number; fatigue: number; cost: number; injury: number }>;
    baseGain: number;
    headroomExponent: number;
    repeatDecay: number;
    fatigueEfficiencyLoss: number;
    randomSpread: number;
    baseInjuryChance: number;
    maxInjuryChance: number;
    injuryHours: { MINOR: number; MODERATE: number };
    moderateInjuryShare: number;
  };
  race: {
    tickSeconds: number;
    frameEverySeconds: number;
    laneWidth: number;
    horseLength: number;
    minField: number;
    maxField: number;
    /**
     * Relative pace shape per phase (EARLY, MIDDLE, LATE). The jockey scales the shape so the
     * planned energy use matches the horse's reserve; the KICK phase is always full effort.
     */
    strategyShape: Record<Strategy, [number, number, number]>;
    /** Share of the energy reserve the plan keeps back for the finish (negative = overspend). */
    strategyReserve: Record<Strategy, number>;
    /** Extra metres of kick distance by strategy. */
    strategyKickBonus: Record<Strategy, number>;
    baseSpeed: number;
    speedPerPoint: number;
    /** Reference average speed (m/s) used to size the energy reserve. */
    refSpeed: number;
    energyScale: number;
    drainScale: number;
    /** Energy drain ∝ effort^drainExponent — higher = even pacing matters more. */
    drainExponent: number;
    /** Max extra kick speed for a horse with surplus energy entering the final stage. */
    freshLegsBoost: number;
    /** Compression (0–1) of every speed modifier's deviation from the reference horse. */
    performanceSpread: number;
    /** Compression (0–1) of energy/efficiency differences (stamina, distance fit). */
    energySpread: number;
    /** Share of top speed an exhausted horse can still hold (before courage). */
    exhaustFloor: number;
    prizeSplit: number[];
    classes: Record<RaceClass, RaceClassConfig>;
    schedule: {
      /** Races are created this far ahead so owners can enter. */
      openMinutesAhead: number;
      /** Entries close (and the field is filled/gated) this long before the start. */
      lockMinutesBefore: number;
      /** House horses fill the field up to this size when players entered. */
      targetField: number;
      everyMinutes: Record<RaceClass, number>;
    };
    eloK: number;
    initialRating: number;
    postRaceFatigueBase: number;
    postRaceFatiguePerKm: number;
    postRaceInjuryBase: number;
    scratchPenalty: number;
  };
  economy: {
    startingCredits: number;
    stableCapacity: number[];
    stableUpgradeCost: number[];
    vetCost: { MINOR: number; MODERATE: number };
    diagnosticsCostGems: number;
  };
  market: {
    /** Platform fee on completed player-to-player sales (credit sink). */
    saleFeeRate: number;
    /** Asking/start price must lie within [min, max] × reference valuation (anti-manipulation). */
    minPriceFactor: number;
    maxPriceFactor: number;
    auctionHours: number[];
    fixedListingDays: number;
    /** A bid in the last N minutes extends the auction to N minutes from now. */
    antiSnipeMinutes: number;
    minIncrementRate: number;
    minIncrement: number;
  };
  generation: {
    rarityWeights: Record<Rarity, number>;
    raritySpread: Record<Rarity, number>;
    rarityGifts: Record<Rarity, number>;
    /** Ceiling mean = base + quality × range. */
    ceilingBase: number;
    ceilingRange: number;
  };
  breeding: {
    heritability: number;
    populationMean: number;
    /** Per-attribute noise. */
    noiseSd: number;
    /** Noise shared by all attributes of a foal (keeps overall-quality variance in the population). */
    sharedNoiseSd: number;
    mutationChance: number;
    mutationMin: number;
    mutationMax: number;
    inbreedingGenerations: number;
    inbreedingCeilingPenalty: number;
  };
}

export const defaultConfig: GameConfig = {
  lifecycle: {
    realDaysPerGameYear: 28,
    minRacingAge: 2,
    voluntaryRetireAge: 6,
    forcedRetireAge: 10,
    ageTrainingMultiplier: {
      0: 0,
      1: 1.25,
      2: 1.2,
      3: 1.0,
      4: 1.0,
      5: 0.85,
      6: 0.5,
      7: 0.45,
      8: 0.4,
      9: 0.3,
    },
  },
  condition: {
    fatigueRecoveryPerHour: 4,
    healthRegenPerHour: 2,
    formDecayPerDay: 0.05,
    minHealthToRace: 60,
    maxFatigueToRace: 70,
    maxFatigueToTrain: 85,
    minHealthToTrain: 60,
  },
  training: {
    types: {
      SPEED: { weights: { speed: 1, acceleration: 0.3 }, baseFatigue: 18, cost: 100, durationMinutes: 60 },
      ACCELERATION: {
        weights: { acceleration: 1, speed: 0.2, start: 0.2 },
        baseFatigue: 16,
        cost: 90,
        durationMinutes: 60,
      },
      STAMINA: { weights: { stamina: 1, endurance: 0.5 }, baseFatigue: 20, cost: 100, durationMinutes: 90 },
      STRENGTH: { weights: { strength: 1, stamina: 0.2 }, baseFatigue: 17, cost: 80, durationMinutes: 60 },
      AGILITY: { weights: { agility: 1, cornering: 0.5 }, baseFatigue: 12, cost: 80, durationMinutes: 45 },
      STARTS: {
        weights: { start: 1, acceleration: 0.3, focus: 0.2 },
        baseFatigue: 10,
        cost: 70,
        durationMinutes: 45,
      },
      FINISHING: { weights: { finalKick: 1, speed: 0.2 }, baseFatigue: 18, cost: 110, durationMinutes: 60 },
      MENTAL: { weights: { focus: 1 }, baseFatigue: 5, cost: 60, durationMinutes: 45 },
      TACTICAL: {
        weights: { cornering: 0.7, focus: 0.4, agility: 0.3 },
        baseFatigue: 9,
        cost: 90,
        durationMinutes: 60,
      },
      RECOVERY: {
        weights: {},
        baseFatigue: 0,
        cost: 60,
        durationMinutes: 120,
        fatigueRelief: 25,
        healthRelief: 10,
      },
    },
    intensity: {
      LIGHT: { gain: 0.6, fatigue: 0.5, cost: 0.6, injury: 0.4 },
      NORMAL: { gain: 1, fatigue: 1, cost: 1, injury: 1 },
      HARD: { gain: 1.4, fatigue: 1.7, cost: 1.5, injury: 2.2 },
    },
    baseGain: 6,
    headroomExponent: 0.8,
    repeatDecay: 0.8,
    fatigueEfficiencyLoss: 0.7,
    randomSpread: 0.15,
    baseInjuryChance: 0.002,
    maxInjuryChance: 0.05,
    injuryHours: { MINOR: 12, MODERATE: 48 },
    moderateInjuryShare: 0.25,
  },
  race: {
    tickSeconds: 0.5,
    frameEverySeconds: 1,
    laneWidth: 1.2,
    horseLength: 2.4,
    minField: 6,
    maxField: 12,
    strategyShape: {
      FRONT_RUNNER: [1.06, 0.99, 0.98],
      PACE_SETTER: [1.03, 1.0, 0.99],
      MID_PACK: [1.0, 1.0, 1.01],
      CLOSER: [0.95, 0.99, 1.04],
      CONSERVATIVE: [0.98, 0.99, 1.02],
      AGGRESSIVE: [1.05, 1.01, 0.99],
    },
    strategyReserve: {
      FRONT_RUNNER: 0.01,
      PACE_SETTER: 0.01,
      MID_PACK: 0.01,
      CLOSER: 0.015,
      CONSERVATIVE: 0.025,
      AGGRESSIVE: 0,
    },
    strategyKickBonus: {
      FRONT_RUNNER: 0,
      PACE_SETTER: 0,
      MID_PACK: 20,
      CLOSER: 60,
      CONSERVATIVE: 30,
      AGGRESSIVE: -20,
    },
    baseSpeed: 15.2,
    speedPerPoint: 0.04,
    refSpeed: 16,
    energyScale: 0.78,
    drainScale: 1,
    drainExponent: 4,
    freshLegsBoost: 0.05,
    performanceSpread: 0.3,
    energySpread: 0.15,
    exhaustFloor: 0.85,
    prizeSplit: [0.5, 0.22, 0.13, 0.08, 0.05, 0.02],
    classes: {
      MAIDEN: {
        entryFee: 100,
        purse: 1500,
        minRating: null,
        maxRating: null,
        maidenOnly: true,
        reputation: [10, 5, 2],
        houseQuality: [0.15, 0.4],
        houseJockeySkill: [30, 55],
      },
      CLASS_5: {
        entryFee: 150,
        purse: 2500,
        minRating: null,
        maxRating: 1099,
        maidenOnly: false,
        reputation: [15, 7, 3],
        houseQuality: [0.25, 0.45],
        houseJockeySkill: [35, 60],
      },
      CLASS_4: {
        entryFee: 250,
        purse: 4000,
        minRating: 1050,
        maxRating: 1199,
        maidenOnly: false,
        reputation: [22, 10, 5],
        houseQuality: [0.35, 0.55],
        houseJockeySkill: [40, 65],
      },
      CLASS_3: {
        entryFee: 400,
        purse: 7000,
        minRating: 1150,
        maxRating: 1299,
        maidenOnly: false,
        reputation: [32, 15, 7],
        houseQuality: [0.45, 0.65],
        houseJockeySkill: [50, 72],
      },
      CLASS_2: {
        entryFee: 650,
        purse: 12000,
        minRating: 1250,
        maxRating: 1399,
        maidenOnly: false,
        reputation: [45, 22, 10],
        houseQuality: [0.55, 0.78],
        houseJockeySkill: [60, 82],
      },
      CLASS_1: {
        entryFee: 1000,
        purse: 20000,
        minRating: 1350,
        maxRating: null,
        maidenOnly: false,
        reputation: [65, 30, 15],
        houseQuality: [0.7, 0.92],
        houseJockeySkill: [70, 92],
      },
    },
    schedule: {
      openMinutesAhead: 60,
      lockMinutesBefore: 2,
      targetField: 8,
      everyMinutes: { MAIDEN: 10, CLASS_5: 15, CLASS_4: 20, CLASS_3: 30, CLASS_2: 45, CLASS_1: 60 },
    },
    eloK: 32,
    initialRating: 1000,
    postRaceFatigueBase: 22,
    postRaceFatiguePerKm: 6,
    postRaceInjuryBase: 0.004,
    scratchPenalty: 0,
  },
  economy: {
    startingCredits: 5000,
    stableCapacity: [3, 5, 8, 12, 20],
    stableUpgradeCost: [4000, 12000, 35000, 90000],
    vetCost: { MINOR: 300, MODERATE: 900 },
    diagnosticsCostGems: 20,
  },
  market: {
    saleFeeRate: 0.06,
    minPriceFactor: 0.2,
    maxPriceFactor: 20,
    auctionHours: [24, 48, 72],
    fixedListingDays: 7,
    antiSnipeMinutes: 5,
    minIncrementRate: 0.05,
    minIncrement: 50,
  },
  generation: {
    rarityWeights: { COMMON: 60, UNCOMMON: 25, RARE: 10, EPIC: 4, LEGENDARY: 1 },
    raritySpread: { COMMON: 6, UNCOMMON: 7, RARE: 8, EPIC: 9, LEGENDARY: 10 },
    rarityGifts: { COMMON: 0, UNCOMMON: 0, RARE: 1, EPIC: 1, LEGENDARY: 2 },
    ceilingBase: 45,
    ceilingRange: 40,
  },
  breeding: {
    heritability: 0.85,
    populationMean: 62,
    noiseSd: 4.5,
    sharedNoiseSd: 4.5,
    mutationChance: 0.01,
    mutationMin: 8,
    mutationMax: 18,
    inbreedingGenerations: 4,
    inbreedingCeilingPenalty: 50,
  },
};

/** Deep-merge a partial override (e.g. from the admin `game_config` table) onto a base config. */
export function mergeConfig<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return override as T;
  if (typeof override !== "object" || Array.isArray(override)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = mergeConfig((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}
