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
