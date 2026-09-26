import {
  RACE_CLASSES,
  STRATEGIES,
  TRAINING_INTENSITIES,
  TRAINING_TYPES,
  type Aptitudes,
  type Attributes,
  type HorseStatus,
  type RaceClass,
  type RaceEventType,
  type Rarity,
  type Sex,
  type Strategy,
  type Surface,
  type TrainingIntensity,
  type TrainingType,
  type Traits,
  type Weather,
} from "@thoroughline/engine";
import { z } from "zod";

/* ─────────────────────────── Requests ─────────────────────────── */

export const TelegramAuthRequest = z.object({ initData: z.string().min(10).max(8192) });
export type TelegramAuthRequest = z.infer<typeof TelegramAuthRequest>;

export const DevAuthRequest = z.object({
  telegramId: z
    .number()
    .int()
    .positive()
    .max(2 ** 52),
  firstName: z.string().min(1).max(64),
  username: z.string().max(64).optional(),
  startParam: z.string().max(64).optional(),
});
export type DevAuthRequest = z.infer<typeof DevAuthRequest>;

export const StartTrainingRequest = z.object({
  type: z.enum(TRAINING_TYPES),
  intensity: z.enum(TRAINING_INTENSITIES),
});
export type StartTrainingRequest = z.infer<typeof StartTrainingRequest>;

export const EnterRaceRequest = z.object({
  horseId: z.string().uuid(),
  strategy: z.enum(STRATEGIES),
});
export type EnterRaceRequest = z.infer<typeof EnterRaceRequest>;

export const RenameStableRequest = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\p{L}\p{N} '&.-]+$/u, "letters, digits, spaces and ' & . - only"),
});
export type RenameStableRequest = z.infer<typeof RenameStableRequest>;

export const CreatePaymentRequest = z.object({ productId: z.string().min(1).max(64) });
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequest>;

export const RaceListQuery = z.object({
  status: z.enum(["upcoming", "live", "recent"]).default("upcoming"),
  class: z.enum(RACE_CLASSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type RaceListQuery = z.infer<typeof RaceListQuery>;

export const LeaderboardQuery = z.object({
  by: z.enum(["rating", "earnings", "wins"]).default("rating"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuery>;

export const CursorQuery = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

export const AdminAdjustRequest = z.object({
  currency: z.enum(["CREDITS", "GEMS", "REPUTATION"]),
  amount: z
    .number()
    .int()
    .refine((v) => v !== 0 && Math.abs(v) <= 10_000_000, "non-zero, |amount| ≤ 10M"),
  reason: z.string().trim().min(5).max(500),
});
export type AdminAdjustRequest = z.infer<typeof AdminAdjustRequest>;

export const AdminReasonRequest = z.object({ reason: z.string().trim().min(5).max(500) });
export type AdminReasonRequest = z.infer<typeof AdminReasonRequest>;

export const AdminUserSearchQuery = z.object({ q: z.string().trim().min(1).max(64) });
export type AdminUserSearchQuery = z.infer<typeof AdminUserSearchQuery>;

export const AdminAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  targetId: z.string().max(64).optional(),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

export const AdminPaymentsQuery = z.object({
  status: z.enum(["CREATED", "PENDING", "COMPLETED", "FAILED", "REFUNDED", "EXPIRED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminPaymentsQuery = z.infer<typeof AdminPaymentsQuery>;

export const AdminRacesQuery = z.object({
  scope: z.enum(["upcoming", "live", "recent"]).default("upcoming"),
});
export type AdminRacesQuery = z.infer<typeof AdminRacesQuery>;

export const FraudFlagsQuery = z.object({
  status: z.enum(["OPEN", "DISMISSED", "CONFIRMED"]).default("OPEN"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type FraudFlagsQuery = z.infer<typeof FraudFlagsQuery>;

export const FraudReviewRequest = z.object({
  decision: z.enum(["DISMISSED", "CONFIRMED"]),
  note: z.string().trim().min(5).max(500),
});
export type FraudReviewRequest = z.infer<typeof FraudReviewRequest>;

/** A full override document (replaces the previous one) plus a mandatory change note. */
export const AdminConfigRequest = z.object({
  override: z.record(z.unknown()),
  note: z.string().trim().min(5).max(500),
});
export type AdminConfigRequest = z.infer<typeof AdminConfigRequest>;

export const AdminCreateRaceRequest = z.object({
  name: z.string().trim().min(3).max(80),
  class: z.enum(RACE_CLASSES),
  trackCode: z.string().min(2).max(20),
  distance: z.number().int().min(800).max(4000),
  startsAt: z.string().datetime(),
  purse: z.number().int().min(0).max(10_000_000).optional(),
  entryFee: z.number().int().min(0).max(1_000_000).optional(),
});
export type AdminCreateRaceRequest = z.infer<typeof AdminCreateRaceRequest>;

export const CreateListingRequest = z.object({
  horseId: z.string().uuid(),
  type: z.enum(["FIXED", "AUCTION"]),
  /** Asking price (FIXED) or starting price (AUCTION), credits. */
  price: z.number().int().positive().max(100_000_000),
  /** Auction length; must be one of the configured options. Ignored for FIXED. */
  durationHours: z.number().int().positive().max(168).optional(),
});
export type CreateListingRequest = z.infer<typeof CreateListingRequest>;

export const BidRequest = z.object({ amount: z.number().int().positive().max(100_000_000) });
export type BidRequest = z.infer<typeof BidRequest>;

export const MarketQuery = z.object({
  type: z.enum(["FIXED", "AUCTION"]).optional(),
  sort: z.enum(["ending", "price_asc", "price_desc", "newest", "rating"]).default("ending"),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type MarketQuery = z.infer<typeof MarketQuery>;

export const SeasonBoardQuery = z.object({
  kind: z.enum(["owners", "horses"]).default("owners"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SeasonBoardQuery = z.infer<typeof SeasonBoardQuery>;

export const TournamentRegisterRequest = z.object({
  horseId: z.string().uuid(),
  strategy: z.enum(STRATEGIES),
});
export type TournamentRegisterRequest = z.infer<typeof TournamentRegisterRequest>;

export const FacilityParam = z.enum(["TRAINING_TRACK", "VET_CLINIC"]);

/* ───────────────────────────── cosmetics ───────────────────────────── */

export const SILK_PATTERNS = [
  "SOLID",
  "HOOPS",
  "SASH",
  "QUARTERED",
  "DIAMONDS",
  "STAR",
  // Racing Pass exclusives (not for sale).
  "CHEVRON",
  "STRIPES",
  "CROSS",
  "CHECK",
] as const;
export type SilkPattern = (typeof SILK_PATTERNS)[number];

/** Racing-silk palette (name → hex). Colours are free; patterns are unlocked with gems. */
export const SILK_COLORS = {
  gold: "#e0b43a",
  black: "#0c0a09",
  white: "#fafaf9",
  scarlet: "#dc2626",
  royal: "#2563eb",
  emerald: "#059669",
  purple: "#7c3aed",
  orange: "#ea580c",
  sky: "#38bdf8",
  pink: "#ec4899",
  navy: "#1e3a8a",
  lime: "#84cc16",
} as const;
export type SilkColor = keyof typeof SILK_COLORS;
const SILK_COLOR_NAMES = Object.keys(SILK_COLORS) as [SilkColor, ...SilkColor[]];

export interface Silks {
  pattern: SilkPattern;
  primary: SilkColor;
  secondary: SilkColor;
}

export const SetSilksRequest = z
  .object({
    pattern: z.enum(SILK_PATTERNS),
    primary: z.enum(SILK_COLOR_NAMES),
    secondary: z.enum(SILK_COLOR_NAMES),
  })
  .refine((s) => s.primary !== s.secondary, "Primary and secondary colours must differ");
export type SetSilksRequest = z.infer<typeof SetSilksRequest>;

export const SilkPatternParam = z.enum(SILK_PATTERNS);

export interface CosmeticsDto {
  silks: Silks;
  /** priceGems is null for Racing Pass exclusives (earned, never sold). */
  patterns: { pattern: SilkPattern; priceGems: number | null; owned: boolean }[];
  gems: number;
}

export interface PassRewardDto {
  gems?: number;
  silk?: SilkPattern;
}

export interface PassTierDto {
  tier: number;
  xpRequired: number;
  free: PassRewardDto | null;
  premium: PassRewardDto | null;
  freeClaimed: boolean;
  premiumClaimed: boolean;
}

export interface RacingPassDto {
  season: number;
  endsAt: string;
  xp: number;
  tier: number;
  maxTier: number;
  xpPerTier: number;
  premium: boolean;
  premiumPriceGems: number;
  gems: number;
  xpRules: { raceRun: number; win: number; second: number; third: number; training: number };
  tiers: PassTierDto[];
}

export const PassClaimRequest = z.object({
  tier: z.number().int().min(1).max(100),
  track: z.enum(["FREE", "PREMIUM"]),
});
export type PassClaimRequest = z.infer<typeof PassClaimRequest>;

export const HireTrainerRequest = z.object({ trainerId: z.string().uuid() });
export const HireJockeyRequest = z.object({ jockeyId: z.string().uuid() });
export type HireTrainerRequest = z.infer<typeof HireTrainerRequest>;

export const BreedRequest = z.object({ sireId: z.string().uuid(), damId: z.string().uuid() });
export type BreedRequest = z.infer<typeof BreedRequest>;

export const StudOfferRequest = z.object({
  horseId: z.string().uuid(),
  fee: z.number().int().min(0).max(1_000_000),
});
export type StudOfferRequest = z.infer<typeof StudOfferRequest>;

/* ─────────────────────────── Responses ─────────────────────────── */

export type Currency = "CREDITS" | "GEMS" | "REPUTATION" | "PRESTIGE";

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface UserDto {
  id: string;
  firstName: string | null;
  username: string | null;
  role: string;
  referralCode: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: UserDto;
  isNew: boolean;
}

export interface WalletDto {
  balances: Record<Currency, number>;
  /** Daily safety-net allowance for owners who are nearly out of credits. */
  allowance?: { amount: number; threshold: number; eligible: boolean };
}

export interface LedgerLineDto {
  id: number;
  currency: Currency;
  amount: number;
  balanceAfter: number;
  type: string;
  reason: string | null;
  createdAt: string;
}

export interface StableDto {
  id: string;
  name: string;
  level: number;
  capacity: number;
  horseCount: number;
  reputation: number;
  nextUpgradeCost: number | null;
  facilities: FacilityDto[];
}

export type FacilityType = "TRAINING_TRACK" | "VET_CLINIC";

export interface FacilityDto {
  type: FacilityType;
  level: number;
  maxLevel: number;
  /** Cost of the next level (null at max level). */
  nextCost: number | null;
  /** Stable level needed for the next level. */
  requiresStableLevel: number | null;
  /** Current effect on training: gain bonus % and injury-risk reduction %. */
  gainPct: number;
  injuryReductionPct: number;
}

export interface ConditionDto {
  fatigue: number;
  health: number;
  form: number;
  /** Hours until fatigue is low enough to race; 0 when ready. */
  hoursToRaceReady: number;
}

export interface TrainingSessionDto {
  id: string;
  horseId: string;
  type: TrainingType;
  intensity: TrainingIntensity;
  cost: number;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  startedAt: string;
  completesAt: string;
  result: {
    gains: Partial<Record<keyof Attributes, number>>;
    injury: { severity: string; hours: number } | null;
  } | null;
  /** Trainer who supervised the session (snapshot at start). */
  trainer: { name: string; gainMultiplier: number; injuryMultiplier: number } | null;
}

export interface TrainerDto {
  id: string;
  name: string;
  skill: number;
  specialty: TrainingType | null;
  /** Weekly salary in credits (charged in advance). */
  salary: number;
  /** Training gain bonus in %, general and in the specialty; injury-risk reduction in %. */
  effect: { gainPct: number; specialtyGainPct: number; injuryReductionPct: number };
}

export interface StaffContractDto {
  id: string;
  trainer: TrainerDto;
  salary: number;
  periods: number;
  startedAt: string;
  paidUntil: string;
}

export interface JockeyDto {
  id: string;
  name: string;
  skill: number;
  /** Weekly salary in credits (charged in advance). */
  salary: number;
  rides: number;
  wins: number;
}

export interface JockeyContractDto {
  id: string;
  jockey: JockeyDto;
  salary: number;
  periods: number;
  startedAt: string;
  paidUntil: string;
}

export interface StaffDto {
  /** Trainer contracts. */
  contracts: StaffContractDto[];
  maxTrainers: number;
  jockeys: JockeyContractDto[];
  maxJockeys: number;
  /** All salaries per week (trainers and jockeys). */
  weeklyCost: number;
}

export interface HorseSummaryDto {
  id: string;
  name: string;
  sex: Sex;
  age: number;
  stage: string;
  rarity: Rarity;
  coat: string;
  bloodline: string;
  status: HorseStatus;
  abilityRating: number;
  raceRating: number;
  record: { starts: number; wins: number; seconds: number; thirds: number; earnings: number };
  ownerId: string | null;
  ownerName: string | null;
  isHouse: boolean;
}

export interface HorseDetailDto extends HorseSummaryDto {
  /** Present only for the owner. */
  private: {
    attributes: Attributes;
    traits: Traits;
    aptitudes: Aptitudes;
    /** 1–5 stars summarising genetic potential (exact values need diagnostics). */
    potentialStars: number;
    /** Reference market value (valuation model) — the market accepts 0.2×–20× of it. */
    marketValue: number;
    /** Active market listing of this horse, if any. */
    listingId: string | null;
    /** Stud fee when the stallion stands at stud, else null. */
    studFee: number | null;
    condition: ConditionDto;
    injuredUntil: string | null;
    activeTraining: TrainingSessionDto | null;
    diagnostics: {
      ceilings: Attributes;
      injurySusceptibility: number;
      maturity: number;
      raceIntelligence: number;
    } | null;
  } | null;
}

export interface RaceEntryDto {
  horseId: string;
  horseName: string;
  ownerName: string | null;
  isHouse: boolean;
  gate: number | null;
  strategy: Strategy | null;
  jockeyName: string | null;
  abilityRating: number;
  raceRating: number;
  position: number | null;
  finishTime: number | null;
  lengthsBehind: number | null;
  prize: number | null;
  mine: boolean;
  /** Owner's racing silks (null for house horses). */
  silks: Silks | null;
}

export type RaceStatus = "OPEN" | "LOCKED" | "RUNNING" | "COMPLETED" | "CANCELLED";

export interface RaceSummaryDto {
  id: string;
  name: string;
  class: RaceClass;
  trackCode: string;
  trackName: string;
  surface: Surface;
  distance: number;
  weather: Weather;
  going: string;
  entryFee: number;
  purse: number;
  status: RaceStatus;
  locksAt: string;
  startsAt: string;
  entries: number;
  maxField: number;
  seedHash: string;
  tournamentId: string | null;
}

export interface RaceDetailDto extends RaceSummaryDto {
  entryList: RaceEntryDto[];
  eligibility: { minRating: number | null; maxRating: number | null; maidenOnly: boolean };
  seed: string | null;
}

export interface LiveRaceDto {
  raceId: string;
  status: RaceStatus;
  /** Seconds since the start; frames are delivered up to this point. */
  elapsed: number;
  duration: number | null;
  distance: number;
  frames: { interval: number; ids: string[]; data: [number, number, number, number][][] } | null;
  commentary: { t: number; text: string }[];
  events: { t: number; type: RaceEventType; horseId?: string }[];
  results: RaceEntryDto[] | null;
}

export interface LeaderboardHorseDto {
  rank: number;
  horseId: string;
  name: string;
  ownerName: string | null;
  value: number;
  raceRating: number;
  wins: number;
  starts: number;
}

export interface LeaderboardOwnerDto {
  rank: number;
  userId: string;
  name: string;
  stableName: string;
  reputation: number;
  earnings: number;
  wins: number;
}

export interface ShopHorseDto extends HorseSummaryDto {
  price: number;
  potentialStars: number;
  optimalDistance: number;
  favouriteSurface: Surface;
}

export interface MarketListingDto {
  id: string;
  type: "FIXED" | "AUCTION";
  status: "ACTIVE" | "SOLD" | "CANCELLED" | "EXPIRED";
  price: number;
  referenceValue: number;
  endsAt: string;
  highestBid: number | null;
  bidCount: number;
  /** Minimum acceptable next bid (auctions) or the price to pay (fixed). */
  minNextBid: number;
  salePrice: number | null;
  sellerName: string | null;
  mine: boolean;
  iAmLeading: boolean;
  horse: ShopHorseDto;
}

export interface MarketListingDetailDto extends MarketListingDto {
  bids: { amount: number; bidderName: string | null; createdAt: string; mine: boolean }[];
  feeRate: number;
}

export interface MarketMineDto {
  listings: MarketListingDto[];
  bids: MarketListingDto[];
}

export interface StudDto {
  horse: ShopHorseDto;
  fee: number;
  ownerName: string | null;
  mine: boolean;
  coversThisWeek: number;
  coversPerWeek: number;
}

export interface BreedingPreviewDto {
  eligible: boolean;
  reasons: string[];
  /** Wright inbreeding coefficient of the prospective foal (0–1). */
  inbreeding: number;
  /** Expected potential grade of the foal from the parents' genetics (1–5). */
  expectedStars: number;
  cost: { breedingFee: number; studFee: number; total: number };
  gestationHours: number;
}

export interface BreedingEventDto {
  id: string;
  sire: { id: string; name: string };
  dam: { id: string; name: string };
  status: "PENDING" | "DELIVERED";
  coveredAt: string;
  dueAt: string;
  deliveredAt: string | null;
  foal: { id: string; name: string } | null;
  studFee: number;
  breedingFee: number;
  inbreeding: number;
}

export interface PedigreeNodeDto {
  id: string;
  name: string;
  sex: Sex;
  rarity: Rarity;
  bloodline: string;
  starts: number;
  wins: number;
  sire: PedigreeNodeDto | null;
  dam: PedigreeNodeDto | null;
}

export interface SeasonDto {
  season: number;
  startsAt: string;
  endsAt: string;
  me: { points: number; rank: number | null; races: number; wins: number };
  rewards: {
    fromRank: number;
    toRank: number;
    credits: number;
    gems: number;
    reputation: number;
    prestige: number;
  }[];
}

export interface SeasonOwnerRowDto {
  rank: number;
  userId: string;
  name: string;
  stableName: string;
  points: number;
  races: number;
  wins: number;
  mine: boolean;
}

export interface SeasonHorseRowDto {
  rank: number;
  horseId: string;
  name: string;
  ownerName: string | null;
  points: number;
  races: number;
  wins: number;
}

export interface HallOfFameDto {
  season: number;
  category: "CHAMPION_OWNER" | "CHAMPION_HORSE" | "TOP_EARNER_HORSE";
  userName: string | null;
  horseId: string | null;
  horseName: string | null;
  value: number;
}

export type TournamentTier = "LOCAL" | "REGIONAL" | "NATIONAL" | "ELITE";
export type TournamentStatus = "REGISTRATION" | "HEATS" | "FINAL" | "COMPLETED" | "CANCELLED";

export interface TournamentEntryDto {
  horseId: string;
  horseName: string;
  ownerName: string | null;
  status: "REGISTERED" | "WITHDRAWN" | "IN_HEAT" | "FINALIST" | "ELIMINATED" | "SCRATCHED";
  heatRaceId: string | null;
  heatPosition: number | null;
  finalPosition: number | null;
  mine: boolean;
}

export interface TournamentDto {
  id: string;
  name: string;
  tier: TournamentTier;
  status: TournamentStatus;
  raceClass: RaceClass;
  trackCode: string;
  trackName: string;
  distance: number;
  entryFee: number;
  purse: number;
  qualification: { minSeasonPoints: number | null; minRating: number | null };
  opensAt: string;
  registrationClosesAt: string;
  heatsAt: string;
  finalAt: string;
  entrants: number;
  maxEntrants: number;
  heatRaceIds: string[];
  finalRaceId: string | null;
  winner: { horseId: string; horseName: string; ownerName: string | null } | null;
  myEntries: TournamentEntryDto[];
}

export interface TournamentDetailDto extends TournamentDto {
  entries: TournamentEntryDto[];
}

export interface ProductDto {
  id: string;
  title: string;
  description: string;
  priceStars: number;
  grants: { gems?: number };
}

export interface PaymentDto {
  id: string;
  productId: string;
  status: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED" | "EXPIRED";
  invoiceLink: string | null;
  amount: number;
  currency: string;
}

export interface QuestDto {
  code: string;
  title: string;
  description: string;
  chapter: number;
  completed: boolean;
  claimed: boolean;
  reward: { credits?: number; gems?: number; reputation?: number };
}

export interface HomeDto {
  user: UserDto;
  wallet: WalletDto;
  stable: StableDto;
  horses: HorseSummaryDto[];
  activeTraining: TrainingSessionDto[];
  myUpcomingRaces: RaceSummaryDto[];
  quests: QuestDto[];
}

export type {
  Attributes,
  Aptitudes,
  HorseStatus,
  RaceClass,
  Rarity,
  Sex,
  Strategy,
  Surface,
  TrainingIntensity,
  TrainingType,
  Traits,
  Weather,
};
export { RACE_CLASSES, STRATEGIES, TRAINING_INTENSITIES, TRAINING_TYPES };
