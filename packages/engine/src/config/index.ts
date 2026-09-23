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

export const FACILITY_TYPES = ["TRAINING_TRACK", "VET_CLINIC"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const TOURNAMENT_TIERS = ["LOCAL", "REGIONAL", "NATIONAL", "ELITE"] as const;
export type TournamentTier = (typeof TOURNAMENT_TIERS)[number];

export interface TournamentTierConfig {
  entryFee: number;
  /** Final purse (minted), split like any race purse. */
  purse: number;
  /** Extra champion reward. */
  championPrestige: number;
  championReputation: number;
  /** Qualification: season points OR race rating (null = open). */
  minSeasonPoints: number | null;
  minRating: number | null;
  /** Class used for house fillers and season points of heats/final. */
  raceClass: RaceClass;
  everyHours: number;
  /** UTC hour-of-cycle offset for the heats start. */
  offsetHours: number;
  maxEntrants: number;
  playersPerHeat: number;
  qualifiersPerHeat: number;
}

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
  /** Age range (game years) of house horses generated for this class. */
  houseAge: [number, number];
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
    /** Safety net: once per day an owner below the threshold may claim the allowance. */
    allowance: { threshold: number; amount: number };
  };
  facilities: Record<
    FacilityType,
    {
      /** Build cost of levels 1..n (the array length is the max level). */
      costs: number[];
      /** Training gain bonus per level (training track). */
      gainPerLevel: number;
      /** Training injury-chance reduction per level (vet clinic). */
      injuryReductionPerLevel: number;
    }
  > & {
    /** Facility level k needs stable level ≥ k + this. */
    stableLevelOffset: number;
  };
  staff: {
    /** Trainer skill range in the hiring pool; skill = minSkill means no effect. */
    minSkill: number;
    maxSkill: number;
    /** Training gain multiplier per skill point above minSkill. */
    gainPerSkill: number;
    /** Extra gain when the session type matches the trainer's speciality. */
    specialtyBonus: number;
    /** Injury-chance reduction per skill point above minSkill. */
    injuryReductionPerSkill: number;
    /** Weekly salary = base + perSkill2 × (skill − minSkill)². */
    salaryBase: number;
    salaryPerSkill2: number;
    /** Trainers an owner may employ, by stable level. */
    maxTrainers: number[];
    /** Unemployed trainers kept available in the pool. */
    poolSize: number;
    contractDays: number;
  };
  tournaments: {
    tiers: Record<TournamentTier, TournamentTierConfig>;
    /** Registration opens this long before the heats. */
    registrationOpenHours: number;
    /** Registration closes (and heats are drawn) this long before the heats. */
    registrationCloseMinutes: number;
    /** Gap between heats and the final. */
    finalAfterMinutes: number;
    /** Minutes between consecutive heats (so each heat can be watched live). */
    heatSpacingMinutes: number;
    maxHorsesPerOwner: number;
  };
  seasons: {
    /** Season 1 starts here (UTC); seasons are consecutive and last one game year. */
    epoch: string;
    /** Points by finishing position (index 0 = winner). */
    placingPoints: number[];
    /** Class weight applied to placing points. */
    classMultiplier: Record<RaceClass, number>;
    /** End-of-season owner rewards by final rank (inclusive rank ranges). */
    rewards: {
      fromRank: number;
      toRank: number;
      credits: number;
      gems: number;
      reputation: number;
      prestige: number;
    }[];
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
    /** Minimum age (game years) for sires and dams. */
    minBreedingAge: number;
    /** Real hours from covering to the foal arriving at the stable. */
    gestationHours: number;
    /**
     * Age at which the foal is delivered to the owner (it is raised at the stud farm until
     * then). A pacing choice: 1.0 means racing age is reached one season after delivery.
     */
    foalAgeAtDelivery: number;
    /** Days a mare rests after delivering before she can be covered again. */
    mareCooldownDays: number;
    /** Max covers per sire in a rolling 7 days. */
    sireCoversPerWeek: number;
    /** Flat breeding cost (credit sink) paid by the mare owner. */
    breedingFee: number;
    /** Platform cut of stud fees (credit sink). */
    studFeeRate: number;
    maxStudFee: number;
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
    fatigueRecoveryPerHour: 1.6,
    healthRegenPerHour: 2,
    formDecayPerDay: 0.05,
    minHealthToRace: 60,
    maxFatigueToRace: 50,
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
        houseQuality: [0.18, 0.42],
        houseJockeySkill: [30, 55],
        houseAge: [2.1, 3.2],
      },
      CLASS_5: {
        entryFee: 150,
        purse: 2400,
        minRating: null,
        maxRating: 1099,
        maidenOnly: false,
        reputation: [15, 7, 3],
        houseQuality: [0.32, 0.52],
        houseJockeySkill: [35, 60],
        houseAge: [2.5, 4.5],
      },
      CLASS_4: {
        entryFee: 250,
        purse: 3900,
        minRating: 1050,
        maxRating: 1199,
        maidenOnly: false,
        reputation: [22, 10, 5],
        houseQuality: [0.52, 0.7],
        houseJockeySkill: [40, 65],
        houseAge: [3, 5],
      },
      CLASS_3: {
        entryFee: 400,
        purse: 6300,
        minRating: 1150,
        maxRating: 1299,
        maidenOnly: false,
        reputation: [32, 15, 7],
        houseQuality: [0.6, 0.78],
        houseJockeySkill: [50, 72],
        houseAge: [3, 5.5],
      },
      CLASS_2: {
        entryFee: 650,
        purse: 10300,
        minRating: 1250,
        maxRating: 1399,
        maidenOnly: false,
        reputation: [45, 22, 10],
        houseQuality: [0.68, 0.86],
        houseJockeySkill: [60, 82],
        houseAge: [3, 5.5],
      },
      CLASS_1: {
        entryFee: 1000,
        purse: 16300,
        minRating: 1350,
        maxRating: null,
        maidenOnly: false,
        reputation: [65, 30, 15],
        houseQuality: [0.76, 0.95],
        houseJockeySkill: [70, 92],
        houseAge: [3.5, 5.5],
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
    postRaceFatigueBase: 30,
    postRaceFatiguePerKm: 8,
    postRaceInjuryBase: 0.004,
    scratchPenalty: 0,
  },
  economy: {
    startingCredits: 5000,
    stableCapacity: [3, 5, 8, 12, 20],
    stableUpgradeCost: [3000, 12000, 35000, 90000],
    vetCost: { MINOR: 300, MODERATE: 900 },
    diagnosticsCostGems: 20,
    allowance: { threshold: 400, amount: 250 },
  },
  facilities: {
    TRAINING_TRACK: { costs: [4000, 12000, 30000], gainPerLevel: 0.04, injuryReductionPerLevel: 0 },
    VET_CLINIC: { costs: [3000, 9000, 24000], gainPerLevel: 0, injuryReductionPerLevel: 0.1 },
    stableLevelOffset: 1,
  },
  staff: {
    minSkill: 40,
    maxSkill: 95,
    gainPerSkill: 0.0025,
    specialtyBonus: 0.05,
    injuryReductionPerSkill: 0.005,
    salaryBase: 100,
    salaryPerSkill2: 0.35,
    maxTrainers: [1, 1, 2, 2, 3],
    poolSize: 12,
    contractDays: 7,
  },
  tournaments: {
    tiers: {
      LOCAL: {
        entryFee: 200,
        purse: 6000,
        championPrestige: 0,
        championReputation: 30,
        minSeasonPoints: null,
        minRating: null,
        raceClass: "CLASS_5",
        everyHours: 24,
        offsetHours: 18,
        maxEntrants: 36,
        playersPerHeat: 6,
        qualifiersPerHeat: 2,
      },
      REGIONAL: {
        entryFee: 500,
        purse: 15000,
        championPrestige: 1,
        championReputation: 60,
        minSeasonPoints: 20,
        minRating: 1100,
        raceClass: "CLASS_4",
        everyHours: 72,
        offsetHours: 19,
        maxEntrants: 36,
        playersPerHeat: 6,
        qualifiersPerHeat: 2,
      },
      NATIONAL: {
        entryFee: 1200,
        purse: 40000,
        championPrestige: 2,
        championReputation: 120,
        minSeasonPoints: 60,
        minRating: 1200,
        raceClass: "CLASS_3",
        everyHours: 168,
        offsetHours: 20,
        maxEntrants: 36,
        playersPerHeat: 6,
        qualifiersPerHeat: 2,
      },
      ELITE: {
        entryFee: 3000,
        purse: 100000,
        championPrestige: 5,
        championReputation: 250,
        minSeasonPoints: 150,
        minRating: 1300,
        raceClass: "CLASS_2",
        everyHours: 336,
        offsetHours: 20,
        maxEntrants: 24,
        playersPerHeat: 6,
        qualifiersPerHeat: 2,
      },
    },
    registrationOpenHours: 24,
    registrationCloseMinutes: 10,
    finalAfterMinutes: 30,
    heatSpacingMinutes: 3,
    maxHorsesPerOwner: 2,
  },
  seasons: {
    epoch: "2026-01-05T00:00:00.000Z",
    placingPoints: [10, 6, 4, 3, 2, 1],
    classMultiplier: { MAIDEN: 1, CLASS_5: 1.5, CLASS_4: 2, CLASS_3: 3, CLASS_2: 4, CLASS_1: 6 },
    rewards: [
      { fromRank: 1, toRank: 1, credits: 25000, gems: 100, reputation: 200, prestige: 3 },
      { fromRank: 2, toRank: 2, credits: 15000, gems: 60, reputation: 120, prestige: 2 },
      { fromRank: 3, toRank: 3, credits: 10000, gems: 40, reputation: 80, prestige: 1 },
      { fromRank: 4, toRank: 10, credits: 5000, gems: 15, reputation: 40, prestige: 0 },
      { fromRank: 11, toRank: 50, credits: 1500, gems: 5, reputation: 15, prestige: 0 },
    ],
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
    minBreedingAge: 3,
    gestationHours: 24,
    foalAgeAtDelivery: 1,
    mareCooldownDays: 7,
    sireCoversPerWeek: 3,
    breedingFee: 500,
    studFeeRate: 0.06,
    maxStudFee: 1_000_000,
  },
};

/** Deep-merge a partial override (e.g. from the admin `game_config` table) onto a base config. */
/**
 * Validate an admin config override against a base config: every key must exist in the base and
 * every value must have the base's shape (numbers finite, arrays of the same element type).
 * Returns human-readable problems (empty = valid).
 */
export function validateConfigOverride(base: unknown, override: unknown, path = ""): string[] {
  const at = path || "(root)";
  if (Array.isArray(base)) {
    if (!Array.isArray(override)) return [`${at}: expected an array`];
    if (base.length === 0) return [];
    return override.flatMap((v, i) => validateConfigOverride(base[0], v, `${path}[${i}]`));
  }
  if (base !== null && typeof base === "object") {
    if (override === null || typeof override !== "object" || Array.isArray(override))
      return [`${at}: expected an object`];
    return Object.entries(override as Record<string, unknown>).flatMap(([k, v]) =>
      k in (base as Record<string, unknown>)
        ? validateConfigOverride((base as Record<string, unknown>)[k], v, path ? `${path}.${k}` : k)
        : [`${path ? `${path}.${k}` : k}: unknown setting`],
    );
  }
  if (typeof base === "number")
    return typeof override === "number" && Number.isFinite(override) ? [] : [`${at}: expected a number`];
  if (base === null)
    return override === null || typeof override === "number" ? [] : [`${at}: expected a number or null`];
  return typeof override === typeof base ? [] : [`${at}: expected a ${typeof base}`];
}

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
