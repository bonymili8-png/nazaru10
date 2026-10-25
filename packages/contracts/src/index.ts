import {
  FEED_PLANS,
  GEAR_ITEMS,
  RACE_CLASSES,
  SHOWDOWN_MODES,
  STRATEGIES,
  SURFACES,
  TRAINING_INTENSITIES,
  TRAINING_TYPES,
  type Aptitudes,
  type Attributes,
  type FeedPlan,
  type GearItem,
  type HorseStatus,
  type RaceClass,
  type RaceEventType,
  type ShowdownMode,
  type ReportInsight,
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
import {
  LATIN_NAME,
  NAME_LIMITS,
  SILK_PATTERNS,
  SILK_COLORS,
  CAMPAIGN_PLATFORMS,
  type CampaignPlatform,
  MEMBER_COLORS,
  CREST_SHAPES,
  CREST_ICONS,
  DEFAULT_CREST,
  CLOTH_PATTERNS,
  FINISH_EFFECTS,
  LOCALES,
  FEED_KINDS,
  type SilkPattern,
  type SilkColor,
  type Silks,
  type CrestShape,
  type CrestIcon,
  type Crest,
  type ClothPattern,
  type SaddleCloth,
  type FinishEffect,
  type Locale,
  type FeedKind,
} from "./constants.js";

export * from "./constants.js";

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

/** Send a horse out for timed morning work against the yard's lead horse for a class. */
export const GallopRequest = z
  .object({
    distance: z.number().int().min(400).max(3000),
    surface: z.enum(SURFACES),
    leadClass: z.enum(RACE_CLASSES),
  })
  .strict();
export type GallopRequest = z.infer<typeof GallopRequest>;

/** Choose a horse's feed plan. STANDARD stops renewal: a paid week still runs to its end. */
export const SetFeedRequest = z.object({ plan: z.enum(FEED_PLANS) }).strict();
export type SetFeedRequest = z.infer<typeof SetFeedRequest>;

export const EnterRaceRequest = z.object({
  horseId: z.string().uuid(),
  strategy: z.enum(STRATEGIES),
  /** Race-day gear the stable owns (optional). */
  gear: z.enum(GEAR_ITEMS).nullable().optional(),
});
export type EnterRaceRequest = z.infer<typeof EnterRaceRequest>;

const latinName = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(2).max(max).regex(LATIN_NAME, "Latin letters, digits, spaces and ' & . - only"));

/** A broadcast handle (e.g. a blogger's @name): Latin letters, digits and _ . - ' & allowed. */
const handle = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(2)
      .max(24)
      .regex(/^@?[A-Za-z0-9][A-Za-z0-9 _'&.-]*$/, "Latin letters, digits, spaces and _ ' & . - only"),
  );

/** 1–3 horses from the player's own stable (OWN_HORSES showdowns). */
const showdownHorseIds = z.array(z.string().uuid()).min(1).max(3);

export const CreateShowdownRequest = z
  .object({
    name: latinName(40),
    mode: z.enum(SHOWDOWN_MODES),
    fillField: z.boolean().default(true),
    displayName: handle,
    /** OWN_HORSES mode: the host's 1–3 horses. */
    horseIds: showdownHorseIds.optional(),
  })
  .strict();
export type CreateShowdownRequest = z.infer<typeof CreateShowdownRequest>;

export const JoinShowdownRequest = z
  .object({ displayName: handle, horseIds: showdownHorseIds.optional() })
  .strict();

/** Change the horses entered (OWN_HORSES), between races. */
export const SetShowdownHorsesRequest = z.object({ horseIds: showdownHorseIds }).strict();
export type SetShowdownHorsesRequest = z.infer<typeof SetShowdownHorsesRequest>;
export type JoinShowdownRequest = z.infer<typeof JoinShowdownRequest>;

/** Call the next race: a distance and surface, or leave either to chance. */
export const CallShowdownRaceRequest = z
  .object({
    distance: z.number().int().nullable().default(null),
    surface: z.enum(SURFACES).nullable().default(null),
  })
  .strict();
export type CallShowdownRaceRequest = z.infer<typeof CallShowdownRaceRequest>;

/** Tactics for the called race; null sits the race out (a tired horse can rest). */
export const ShowdownTacticsRequest = z
  .object({
    strategy: z.enum(STRATEGIES).nullable(),
    /** OWN_HORSES: which of the player's horses (each has its own tactics). */
    horseId: z.string().uuid().optional(),
  })
  .strict();
export type ShowdownTacticsRequest = z.infer<typeof ShowdownTacticsRequest>;

export const RenameStableRequest = z.object({ name: latinName(NAME_LIMITS.stable) }).strict();
export type RenameStableRequest = z.infer<typeof RenameStableRequest>;

export const RenameHorseRequest = z.object({ name: latinName(NAME_LIMITS.horse) }).strict();
export type RenameHorseRequest = z.infer<typeof RenameHorseRequest>;

export const CreatePaymentRequest = z.object({ productId: z.string().min(1).max(64) });
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequest>;

export const RaceListQuery = z.object({
  status: z.enum(["upcoming", "live", "recent"]).default("upcoming"),
  class: z.enum(RACE_CLASSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Only races the viewer has a horse in. */
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
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

/** Dismiss every open flag of one weak network kind at once (audited). */
export const FraudBulkDismissRequest = z.object({
  kind: z.enum(["SHARED_IP", "REFERRAL_SHARED_IP", "REFERRAL_CLUSTER"]),
  note: z.string().trim().min(5).max(500),
});
export type FraudBulkDismissRequest = z.infer<typeof FraudBulkDismissRequest>;

/** A full override document (replaces the previous one) plus a mandatory change note. */
export const AdminConfigRequest = z.object({
  override: z.record(z.unknown()),
  note: z.string().trim().min(5).max(500),
});
export type AdminConfigRequest = z.infer<typeof AdminConfigRequest>;

/** Live-ops events (game team). */
export interface LiveEventDto {
  id: string;
  kind: "PASS_XP_BOOST" | "PURSE_BOOST";
  title: string;
  multiplier: number;
  /** Purse boosts may target some classes (null = all). */
  classes: RaceClass[] | null;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
}

export const CreateLiveEventRequest = z
  .object({
    kind: z.enum(["PASS_XP_BOOST", "PURSE_BOOST"]),
    title: z.string().trim().min(3).max(60),
    multiplier: z.number().gt(1).max(3),
    classes: z.array(z.enum(RACE_CLASSES)).min(1).nullable().default(null),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .strict();
export type CreateLiveEventRequest = z.infer<typeof CreateLiveEventRequest>;

/** A limited horse drop for the shop (game team). */
export const CreateLimitedHorseRequest = z
  .object({
    rarity: z.enum(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]),
    quality: z.number().min(0.2).max(0.95),
    price: z.number().int().min(500).max(1_000_000),
    hours: z.number().int().min(1).max(168),
  })
  .strict();
export type CreateLimitedHorseRequest = z.infer<typeof CreateLimitedHorseRequest>;

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

/** Finished tournaments, newest first: everyone's, or only those the viewer entered. */
export const TournamentHistoryQuery = z.object({
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** Cursor: the `heatsAt` of the last tournament already shown. */
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type TournamentHistoryQuery = z.infer<typeof TournamentHistoryQuery>;

export const FacilityParam = z.enum(["TRAINING_TRACK", "VET_CLINIC"]);
export const GearParam = z.enum(GEAR_ITEMS);

/* ───────────────────────────── cosmetics ───────────────────────────── */

const SILK_COLOR_NAMES = Object.keys(SILK_COLORS) as [SilkColor, ...SilkColor[]];

export const SetSilksRequest = z
  .object({
    pattern: z.enum(SILK_PATTERNS),
    primary: z.enum(SILK_COLOR_NAMES),
    secondary: z.enum(SILK_COLOR_NAMES),
  })
  .refine((s) => s.primary !== s.secondary, "Primary and secondary colours must differ");
export type SetSilksRequest = z.infer<typeof SetSilksRequest>;

export const SilkPatternParam = z.enum(SILK_PATTERNS);

export const SetCrestRequest = z
  .object({
    shape: z.enum(CREST_SHAPES),
    icon: z.enum(CREST_ICONS),
    field: z.enum(SILK_COLOR_NAMES),
    charge: z.enum(SILK_COLOR_NAMES),
  })
  .refine((c) => c.field !== c.charge, "Field and emblem colours must differ");
export type SetCrestRequest = z.infer<typeof SetCrestRequest>;

export const CrestIconParam = z.enum(CREST_ICONS);

export const SetClothRequest = z
  .object({
    pattern: z.enum(CLOTH_PATTERNS),
    color: z.enum(SILK_COLOR_NAMES),
    trim: z.enum(SILK_COLOR_NAMES),
  })
  .refine((c) => c.color !== c.trim, "Cloth and trim colours must differ");
export type SetClothRequest = z.infer<typeof SetClothRequest>;

export const ClothPatternParam = z.enum(CLOTH_PATTERNS);

export const FinishEffectParam = z.enum(FINISH_EFFECTS);
export const SetFinishEffectRequest = z.object({ effect: z.enum(FINISH_EFFECTS) }).strict();

export interface CosmeticsDto {
  silks: Silks;
  /** priceGems is null for Racing Pass exclusives (earned, never sold). */
  patterns: { pattern: SilkPattern; priceGems: number | null; owned: boolean }[];
  crest: Crest;
  crestIcons: { icon: CrestIcon; priceGems: number; owned: boolean }[];
  clothPatterns: { pattern: ClothPattern; priceGems: number; owned: boolean }[];
  finishEffect: FinishEffect;
  finishEffects: { effect: FinishEffect; priceGems: number; owned: boolean }[];
  gems: number;
  /** Whether the viewer may use MEMBER_COLORS. */
  member: boolean;
}

export interface PassRewardDto {
  gems?: number;
  /** Free track only (earned by playing, never bought). */
  credits?: number;
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

export interface UserSettingsDto {
  /** Explicit choice; null means "follow the Telegram language". */
  locale: Locale | null;
  /** Master switch for bot messages. */
  notifications: boolean;
  /** "Your horse goes off in 2 min — watch live" (needs `notifications`). */
  raceStartAlerts: boolean;
  /** The morning stable report (needs `notifications`). */
  dailyReport: boolean;
  /** Show the stable's name on public share pages (off: horses appear without an owner). */
  publicStable: boolean;
  /** After a win or a place, suggest sharing the replay (a few times a week at most). */
  sharePrompts: boolean;
}

export const UpdateSettingsRequest = z
  .object({
    locale: z.enum(LOCALES).nullable().optional(),
    notifications: z.boolean().optional(),
    raceStartAlerts: z.boolean().optional(),
    dailyReport: z.boolean().optional(),
    publicStable: z.boolean().optional(),
    sharePrompts: z.boolean().optional(),
  })
  .strict()
  .refine((s) => Object.keys(s).length > 0, "Nothing to update");
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

/* ───────────────────────────── sponsors ───────────────────────────── */

export interface SponsorGoalDto {
  result: "START" | "TOP3" | "WIN";
  surface?: Surface;
  minDistance?: number;
  maxDistance?: number;
  minWetness?: number;
  count: number;
}

export interface SponsorOfferDto {
  code: string;
  name: string;
  goal: SponsorGoalDto;
  reward: number;
  reputation: number;
}

export interface SponsorContractDto extends SponsorOfferDto {
  id: string;
  progress: number;
  status: "ACTIVE" | "COMPLETED" | "EXPIRED";
  expiresAt: string;
  completedAt: string | null;
}

export interface SponsorsDto {
  week: number;
  weekEndsAt: string;
  offers: SponsorOfferDto[];
  active: SponsorContractDto | null;
  /** True once a contract was signed this week (one per week). */
  signedThisWeek: boolean;
  history: SponsorContractDto[];
}

/* ───────────────────────────── feed ───────────────────────────── */

export const FeedQuery = z.object({
  scope: z.enum(["all", "club"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export interface FeedItemDto {
  id: number;
  kind: FeedKind;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  /** Values for the kind's message template (names, numbers). */
  vars: Record<string, string | number>;
  /** In-app link (race, horse, club), if any. */
  link: string | null;
}

/* ───────────────────────────── syndicates ───────────────────────────── */

export const ShareOfferRequest = z.object({
  shares: z.number().int().min(1).max(10),
  pricePerShare: z.number().int().min(1).max(10_000_000),
});
export type ShareOfferRequest = z.infer<typeof ShareOfferRequest>;

export const BuySharesRequest = z.object({ shares: z.number().int().min(1).max(10) });

export interface SyndicatePartnerDto {
  userId: string;
  name: string;
  shares: number;
}

export interface SyndicateDto {
  horseId: string;
  totalShares: number;
  maxPartnerShares: number;
  managerId: string;
  managerName: string;
  managerShares: number;
  partners: SyndicatePartnerDto[];
  offer: { pricePerShare: number; available: number } | null;
  myShares: number;
  /** Allowed price per share (manager only). */
  priceBand: { min: number; max: number } | null;
  feeRate: number;
}

export interface ShareOfferDto {
  horse: HorseSummaryDto;
  managerName: string;
  pricePerShare: number;
  available: number;
  totalShares: number;
}

export interface MyShareDto {
  horse: HorseSummaryDto;
  shares: number;
  totalShares: number;
  costPaid: number;
  /** Prize money received from this horse so far. */
  earned: number;
}

/* ───────────────────────────── clubs ───────────────────────────── */

export const ClubDonateRequest = z.object({ amount: z.number().int().positive() }).strict();
/** A Telegram group or channel invite link (t.me/+code, t.me/joinchat/code or t.me/name); null clears it. */
export const ClubChatRequest = z
  .object({
    url: z
      .string()
      .trim()
      .regex(/^https:\/\/t\.me\/(\+|joinchat\/)?[A-Za-z0-9_-]{4,64}$/, "A t.me link")
      .nullable(),
  })
  .strict();

export const CreateClubRequest = z.object({
  name: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[\p{L}\p{N} '&.-]+$/u, "Letters, digits, spaces and ' & . - only"),
  tag: z
    .string()
    .trim()
    .min(2)
    .max(4)
    .regex(/^[\p{L}\p{N}]+$/u, "Letters and digits only")
    .transform((s) => s.toUpperCase()),
  description: z.string().trim().max(140).default(""),
});
export type CreateClubRequest = z.infer<typeof CreateClubRequest>;

export const ClubListQuery = z.object({
  q: z.string().trim().max(24).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export type ClubRole = "OWNER" | "MEMBER";

export interface ClubSummaryDto {
  id: string;
  name: string;
  tag: string;
  description: string;
  members: number;
  maxMembers: number;
  /** Sum of current members' points this season. */
  points: number;
  /** Rank this season among clubs with points (null without points). */
  rank: number | null;
}

export interface ClubMemberDto {
  userId: string;
  name: string;
  stableName: string;
  crest: Crest;
  member: boolean;
  role: ClubRole;
  points: number;
  joinedAt: string;
}

export interface ClubDetailDto extends ClubSummaryDto {
  season: number;
  level: number;
  /** Treasury balance and next level's cost (members only; null otherwise / at max level). */
  treasury: number | null;
  nextLevelCost: number | null;
  minDonation: number;
  /** Telegram group link (members only). */
  chatUrl: string | null;
  memberList: ClubMemberDto[];
  myRole: ClubRole | null;
  /** Why the viewer cannot join right now (null = can join, or already a member). */
  joinBlocked: null | "IN_CLUB" | "FULL" | "COOLDOWN";
  cooldownUntil: string | null;
}

export interface MyClubDto {
  clubId: string | null;
  createCost: number;
  cooldownUntil: string | null;
}

export interface ReferralDto {
  /** The invitee's first name (nothing more is shared). */
  name: string;
  joinedAt: string;
  /**
   * PAID — both rewards credited; WAITING_RACE — they have not run a race yet;
   * WAITING_DAY — raced, reward due once their account is a day old (readyAt);
   * PROCESSING — due now, credited within minutes; REVIEW — signs in from your network, held
   * until an admin checks it; SAME_NETWORK — review found it is not a separate player (no reward).
   */
  status: "PAID" | "WAITING_RACE" | "WAITING_DAY" | "PROCESSING" | "REVIEW" | "SAME_NETWORK";
  readyAt: string | null;
}

export interface UserDto {
  id: string;
  firstName: string | null;
  username: string | null;
  role: string;
  referralCode: string;
  createdAt: string;
  settings: UserSettingsDto;
  /** Owners' Circle member (subscription benefits active). */
  member: boolean;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: UserDto;
  isNew: boolean;
}

export interface WalletDto {
  balances: Record<Currency, number>;
  /** Flat credits for the owner's first race of the UTC day; `earnedToday` once paid. */
  dailyRaceBonus?: { amount: number; earnedToday: boolean };
  /** Daily safety-net allowance for owners who are nearly out of credits. */
  allowance?: { amount: number; threshold: number; eligible: boolean };
}

/** Buying credits with gems: the bundles on offer and what is left of today's cap. */
export interface GemExchangeDto {
  /** The admin's switch; when off the shop hides the exchange and the server refuses it. */
  enabled: boolean;
  /** Credits per gem at the smallest bundle. */
  baseRate: number;
  bundles: { gems: number; credits: number; bonusPct: number }[];
  dailyCreditLimit: number;
  /** Credits this owner bought today (UTC) and may still buy. */
  creditsToday: number;
  creditsLeft: number;
  /** When today's cap resets (next UTC midnight). */
  resetsAt: string;
}

/**
 * Buy one bundle. `credits` is what the owner was shown (refused if the admin changed the bundle
 * meanwhile); `requestId` makes a retried tap a no-op.
 */
export const GemExchangeRequest = z.object({
  gems: z.number().int().positive(),
  credits: z.number().int().positive(),
  requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});
export type GemExchangeRequest = z.infer<typeof GemExchangeRequest>;

export interface GemExchangeResultDto {
  exchange: GemExchangeDto;
  balances: Record<Currency, number>;
  /** True when this requestId had already been processed. */
  replayed: boolean;
}

/** Admin: switch the exchange on or off (a new audited config version). */
export const AdminGemExchangeToggle = z.object({
  enabled: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type AdminGemExchangeToggle = z.infer<typeof AdminGemExchangeToggle>;

/** Admin view of the exchange: the switch, the offer and what it moved. */
/** Admin: an on/off switch and its recent changes. */
export interface AdminSwitchDto {
  enabled: boolean;
  history: { enabled: boolean; at: string; by: string | null; note: string | null }[];
}

/** Admin: flip an on/off switch (a new audited config version). */
export const AdminSwitchToggle = z.object({
  enabled: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type AdminSwitchToggle = z.infer<typeof AdminSwitchToggle>;

export interface AdminGemExchangeDto {
  enabled: boolean;
  dailyCreditLimit: number;
  bundles: { gems: number; credits: number; bonusPct: number }[];
  /** Totals over the last 24 hours, 7 days and all time. */
  stats: {
    period: "DAY" | "WEEK" | "ALL";
    exchanges: number;
    owners: number;
    gems: number;
    credits: number;
  }[];
  /** The last switch changes, newest first. */
  history: { enabled: boolean; at: string; by: string | null; note: string | null }[];
}

/** A horse as anyone may see it on a public share page (no attributes, owner only by consent). */
export interface PublicHorseDto {
  id: string;
  name: string;
  sex: string;
  age: number;
  coat: string;
  retired: boolean;
  raceRating: number;
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  earnings: number;
  /** The owner's stable name, only if they allow it (settings.publicStable). */
  stable: string | null;
  recent: {
    raceId: string;
    raceName: string;
    distance: number;
    startsAt: string;
    position: number | null;
    field: number;
  }[];
}

/** A visit to a public share page (counted per day, target and sharer). */
export const ShareVisitRequest = z.object({
  kind: z.enum(["race", "horse"]),
  id: z.string().uuid(),
  ref: z
    .string()
    .regex(/^[A-Za-z0-9]{1,16}$/)
    .optional(),
});
export type ShareVisitRequest = z.infer<typeof ShareVisitRequest>;

/** Admin: the viral loop over a period. */
export interface ViralStatsDto {
  days: number;
  /** Visits to public share pages, and those that came with a sharer's code. */
  shareVisits: number;
  sharedByPlayers: number;
  /** Distinct players whose shares were visited. */
  sharers: number;
  /** New players who joined through a friend's invite, and those who then ran a race. */
  referredSignups: number;
  referredFirstRace: number;
  /** Players active in the period (signed in). */
  activePlayers: number;
  /** Invited players who ran a race, per active player. */
  kFactor: number;
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
  /** Gem prices to rename the stable or one of its horses. */
  renameGems: { stable: number; horse: number };
  facilities: FacilityDto[];
  /** Race-day gear on offer; `owned` once bought (one purchase per stable). */
  gear: GearDto[];
  crest: Crest;
  /** Stable mastery: levels earned only by playing, with their current edges. */
  mastery: MasteryDto;
}

export interface MasteryTrackDto {
  track: "TRAINING" | "RACING" | "BREEDING";
  xp: number;
  level: number;
  maxLevel: number;
  /** XP for the next level; null at the top. */
  nextAt: number | null;
  /** Current edge in percent (training +gain, racing −post-race fatigue, breeding −gestation). */
  bonusPct: number;
  /** Edge per level, in percent. */
  perLevelPct: number;
}

export interface MasteryDto {
  tracks: MasteryTrackDto[];
}

export interface GearDto {
  item: GearItem;
  cost: number;
  /** Race-day attribute changes, e.g. { focus: 10, agility: -3 }. */
  mods: Partial<Record<keyof Attributes, number>>;
  owned: boolean;
  /** Races left before the item wears out (null when not owned). */
  racesLeft: number | null;
  /** Credits to restore it to full (0 when unused or not owned). */
  repairCost: number;
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
  /** Hours until fatigue no longer costs race-day strength (≤ FRESH_FATIGUE); 0 when fresh. */
  hoursToFresh: number;
}

/** A followed horse with its next race, if it is entered in one. */
export interface FollowedHorseDto {
  horse: HorseSummaryDto;
  nextRace: { id: string; name: string; startsAt: string } | null;
}

/** Trainer's advice for one of the owner's horses (from owner-visible data only). */
export interface HorseAdviceDto {
  profile: "SPRINTER" | "MILER" | "STAYER";
  training: { type: TrainingType; attribute: keyof Attributes };
  /** Hours until rested enough to race (0 = ready). */
  restHours: number;
  /** Open races the horse may enter, best fit first. */
  races: RaceSummaryDto[];
}

/** Results of a horse's past runs grouped by one key (tactics, surface or trip). */
export interface RunStatsDto {
  key: string;
  runs: number;
  wins: number;
  top3: number;
  avgPosition: number;
}

/** Expert trainer's advice (bought per horse with gems). */
export interface ExpertAdviceDto {
  horseId: string;
  locked: boolean;
  priceGems: number;
  /** Whether diagnostics are done (ceilings sharpen the training plan). */
  diagnosed: boolean;
  advice: {
    profile: "SPRINTER" | "MILER" | "STAYER";
    tactics: { strategy: Strategy; reasons: string[] }[];
    distance: { best: number; min: number; max: number };
    going: "SOFT" | "FIRM" | "ANY";
    surfaces: { surface: Surface; affinity: number }[];
    gear: { item: GearItem; helps: keyof Attributes }[];
    training: { type: TrainingType; attribute: keyof Attributes; headroom: number | null }[];
    traits: string[];
    history: { byStrategy: RunStatsDto[]; bySurface: RunStatsDto[]; byTrip: RunStatsDto[] };
  } | null;
}

export interface FeedDto {
  plan: FeedPlan;
  /** End of the paid week (null on the free standard plan). */
  paidUntil: string | null;
  /** Whether the plan renews at paidUntil (false = it falls back to STANDARD then). */
  renews: boolean;
  /** Plans on offer with their weekly cost and effect (multipliers). */
  options: { plan: FeedPlan; weeklyCost: number; recovery: number; regen: number; formDecay: number }[];
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
  /** Owner-chosen saddle cloth; null = the default (house horses always null). */
  cloth: SaddleCloth | null;
}

export interface HorseDetailDto extends HorseSummaryDto {
  /** Price band for an offer on this horse (null when the viewer cannot make one). */
  offerBand: { min: number; max: number } | null;
  /** Whether the viewer follows this horse, and how many players do. */
  followed: boolean;
  followers: number;
  /**
   * What any other player sees: the horse's attributes, and the scouting report on its genetic
   * potential once the viewer has bought it (null for the owner).
   */
  public: {
    attributes: Attributes;
    /** Null for house horses (nobody can buy them). */
    scouting: { priceGems: number; report: ScoutReportDto | null } | null;
  } | null;
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
    feed: FeedDto;
    care: CareDto;
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

/** A tip: the 1st pick, optionally the 2nd and 3rd (distinct runners of the race). */
export const TipRequest = z.object({ picks: z.array(z.string().uuid()).min(1).max(3) }).strict();
export type TipRequest = z.infer<typeof TipRequest>;

/** Tipping on one race: each runner's tip value and the viewer's tip. */
export interface RaceTipsDto {
  /** Tips can be placed or changed until the start. */
  open: boolean;
  closesAt: string;
  /** The field is final (entries closed); until then values move as runners join. */
  final: boolean;
  /** Points for naming each runner the winner. */
  values: { horseId: string; value: number }[];
  myTip: {
    picks: string[];
    points: number | null;
    slots: number[] | null;
    tricast: number;
    void: boolean;
  } | null;
  /** How many players tipped this race. */
  tipsters: number;
  dailyLeft: number;
}

export interface TipsterRowDto {
  rank: number;
  userId: string;
  name: string;
  points: number;
  tips: number;
  /** Tips whose 1st pick won. */
  winners: number;
  me: boolean;
}

export interface TipsDto {
  weekStart: string;
  weekEnd: string;
  dailyLimit: number;
  dailyLeft: number;
  me: { rank: number | null; points: number; tips: number; winners: number };
  table: TipsterRowDto[];
  /** Last week's final table (top 3) and what the places win. */
  lastWeek: TipsterRowDto[];
  rewards: { gems: number; reputation: number }[];
  rules: { placeExact: number; placeAny: number; tricastBonus: number; minValue: number; maxValue: number };
  /** Races open for tips (with players' horses), soonest first. */
  upcoming: {
    raceId: string;
    name: string;
    class: RaceClass;
    startsAt: string;
    runners: number;
    tipped: boolean;
  }[];
  /** The viewer's recent tips. */
  myTips: {
    raceId: string;
    raceName: string;
    startsAt: string;
    status: "PENDING" | "SCORED" | "VOID";
    picks: { horseId: string; horseName: string }[];
    points: number | null;
  }[];
}

export const CreateCampaignRequest = z
  .object({
    name: z.string().trim().min(2).max(80),
    partner: z.string().trim().max(80).optional(),
    platform: z.enum(CAMPAIGN_PLATFORMS).default("OTHER"),
    note: z.string().trim().max(500).optional(),
    /** Optional custom code (letters and digits); generated when omitted. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,12}$/, "4–12 Latin letters or digits")
      .optional(),
  })
  .strict();
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequest>;

/** Optional period for campaign analytics: ISO dates, `to` exclusive. */
export const CampaignPeriodQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** One tracked link and its funnel for the chosen period. */
export interface CampaignDto {
  id: string;
  code: string;
  name: string;
  partner: string | null;
  platform: CampaignPlatform;
  note: string | null;
  createdAt: string;
  archived: boolean;
  /** Start parameter the Mini App receives (`c_CODE`). */
  startParam: string;
  funnel: {
    /** Visits to the tracked link, and distinct visitors. */
    clicks: number;
    visitors: number;
    /** Players who opened the game from the link (new and returning). */
    opened: number;
    /** New players the link brought in (counted once, by the first link they came from). */
    newPlayers: number;
    /** Of the new players: ran a race, came back on a later day, active in the last 7 days. */
    firstRace: number;
    returned: number;
    active7d: number;
    /** Of the new players: bought gems, and the Stars they paid (net of refunds). */
    payers: number;
    stars: number;
  };
}

/** Genetic potential of a horse, as the owner's diagnostics shows it (bought by other players). */
export interface ScoutReportDto {
  potentialStars: number;
  ceilings: Attributes;
  injurySusceptibility: number;
  maturity: number;
  raceIntelligence: number;
}

/** One owner in a player search. */
export interface OwnerCardDto {
  userId: string;
  name: string;
  stableName: string;
  crest: Crest;
  level: number;
  member: boolean;
  horses: number;
}

/** A horse as anyone sees it in another owner's stable (attributes only on its own page). */
export interface PublicStableHorseDto extends HorseSummaryDto {
  /** Offer price band, or null when the viewer cannot make an offer on it. */
  offerBand: { min: number; max: number } | null;
}

/** Any owner's stable, open to every player. */
export interface PublicStableDto {
  userId: string;
  name: string;
  stableName: string;
  crest: Crest;
  level: number;
  reputation: number;
  member: boolean;
  isMe: boolean;
  record: { starts: number; wins: number; earnings: number };
  horses: PublicStableHorseDto[];
}

export const OwnerSearchQuery = z.object({ q: z.string().trim().min(2).max(40) });
export type OwnerSearchQuery = z.infer<typeof OwnerSearchQuery>;

export type CareAction = "GROOM" | "HAND_WALK" | "COLD_HOSE" | "MASSAGE" | "FARRIER";

/** One daily-care action for a horse: ready now, or why not / when. */
export interface CareActionDto {
  action: CareAction;
  ready: boolean;
  /** COOLDOWN (see availableAt), NO_RECENT_RACE, ALREADY_HOSED, SHOES_FRESH, or BUSY (horse away). */
  block: string | null;
  availableAt: string | null;
  bond: number;
  fatigueRelief: number;
}

/** Daily care of a horse (free: the owner's time). */
export interface CareDto {
  /** Trust 0–100: steadier and calmer on race day. */
  bond: number;
  actions: CareActionDto[];
  /** Starts run on the current shoes, and how many before they are worn. */
  shoeStarts: number;
  shoeLimit: number;
  /** A massage is waiting to help the next start. */
  massaged: boolean;
}

export interface ShowdownPlayerDto {
  userId: string;
  displayName: string;
  horseName: string;
  rank: number;
  points: number;
  wins: number;
  races: number;
  /** Current fatigue (always 0 in NO_FATIGUE showdowns). */
  fatigue: number;
  optimalDistance: number;
  favouriteSurface: Surface;
  isHost: boolean;
  me: boolean;
  /** OWN_HORSES: the player's entered horses from their stable (empty in other modes). */
  horses: { id: string; name: string; raceRating: number; abilityRating: number }[];
}

export type ShowdownRaceStatus = "CALLED" | "RUNNING" | "COMPLETED" | "CANCELLED";

export interface ShowdownRaceDto {
  id: string;
  no: number;
  distance: number;
  surface: Surface;
  trackCode: string;
  trackName: string;
  weather: Weather;
  going: string;
  status: ShowdownRaceStatus;
  startsAt: string;
  resultsAt: string | null;
  /** Players only, in finishing order, once the result is public. */
  results: { displayName: string; horseName: string; position: number; points: number }[] | null;
  /** The viewer's choice for a called race (null: sitting out or not a player). */
  myStrategy: Strategy | null;
  myResting: boolean;
  /** OWN_HORSES: the viewer's horses with their tactics (strategy null: sitting this one out). */
  myHorses: { horseId: string; horseName: string; strategy: Strategy | null }[];
}

export interface ShowdownDto {
  id: string;
  code: string;
  name: string;
  mode: ShowdownMode;
  fillField: boolean;
  status: "OPEN" | "FINISHED";
  hostName: string;
  isHost: boolean;
  joined: boolean;
  maxPlayers: number;
  /** OWN_HORSES: horses per player, and the most runners in one race. */
  maxHorsesPerPlayer: number;
  maxOwnField: number;
  callSeconds: number;
  distances: number[];
  players: ShowdownPlayerDto[];
  /** Newest first. */
  races: ShowdownRaceDto[];
  /** The race being called, run or just finished, as the live view needs it. */
  current: RaceDetailDto | null;
}

export interface ShowdownSummaryDto {
  code: string;
  name: string;
  mode: ShowdownMode;
  status: "OPEN" | "FINISHED";
  players: number;
  races: number;
  isHost: boolean;
}

/** Stable lads (hired for gems) who do the yard round for the owner. */
export interface StableLadsDto {
  /** Lads on duty now (0 = none). */
  lads: number;
  paidUntil: string | null;
  /** Horses in the yard, the lads that takes, and how many the current team looks after. */
  horses: number;
  needed: number;
  covered: number;
  gemsPerLadWeek: number;
  horsesPerLad: number;
  maxLads: number;
  /** Gems to add the second lad for the rest of the paid period (null if not possible). */
  upgradeGems: number | null;
  /** False once the paid period reaches the limit ahead. */
  canExtend: boolean;
  /** The last round that found work, and how many jobs it did. */
  lastWorkAt: string | null;
  lastWorkJobs: number;
}

export const HireLadsRequest = z.object({ lads: z.number().int().min(1).max(5) }).strict();
export type HireLadsRequest = z.infer<typeof HireLadsRequest>;

/** One piece of timed work. Margin in lengths: positive = beat the lead horse. */
export interface GallopDto {
  id: string;
  at: string;
  distance: number;
  surface: Surface;
  leadClass: RaceClass;
  /** The horse's fatigue when it went out. */
  fatigue: number;
  time: number;
  leadTime: number;
  margin: number;
}

export interface GallopsDto {
  ready: boolean;
  /** COOLDOWN (see availableAt), TOO_TIRED, NOT_FIT (health), BUSY (status), TOO_YOUNG. */
  block: string | null;
  availableAt: string | null;
  distances: number[];
  /** Fatigue the work costs. */
  fatigueCost: number;
  /** The owner's last pieces of work with this horse, newest first. */
  history: GallopDto[];
}

export type YardEventKind = "LOST_SHOE" | "HEAT_IN_LEG" | "OFF_FEED" | "CAST_IN_BOX";
export type YardChoice = "ACT" | "WAIT";

/** What a yard-event choice did to the horse (and the wallet). */
export interface YardOutcomeDto {
  credits: number;
  fatigue: number;
  health: number;
  bond: number;
  shoesWorn: boolean;
  freshShoes: boolean;
  injuryFactor: number;
  /** A risk that did not come off. */
  bad: boolean;
  /** The horse had left the stable before the event settled: nothing happened. */
  void?: boolean;
}

/** Something that happened in the yard; open until answered or expired. */
export interface YardEventDto {
  id: string;
  horseId: string;
  horseName: string;
  kind: YardEventKind;
  happenedAt: string;
  expiresAt: string;
  /** Price of the ACT choice in credits (0: acting costs the horse time instead). */
  actCost: number;
  choice: YardChoice | null;
  /** False when it settled on its own (nobody answered in time). */
  answered: boolean;
  outcome: YardOutcomeDto | null;
}

export interface YardDto {
  /** Open events first, then the last day's settled ones. */
  events: YardEventDto[];
}

/** The stable round: every horse with the care it can have right now. */
export interface CareRoundDto {
  horses: { horseId: string; name: string; bond: number; ready: CareAction[] }[];
}

export interface RaceEntryDto {
  horseId: string;
  horseName: string;
  ownerName: string | null;
  /** The owner, for a link to their stable (null for house horses and showdown runners). */
  ownerId: string | null;
  /** Recent form: finishing positions of the last starts, most recent last (e.g. "4-2-1"). */
  form: string | null;
  isHouse: boolean;
  gate: number | null;
  strategy: Strategy | null;
  /** Race-day gear (hidden from rivals until the race runs, like tactics). */
  gear: GearItem | null;
  jockeyName: string | null;
  abilityRating: number;
  raceRating: number;
  position: number | null;
  finishTime: number | null;
  lengthsBehind: number | null;
  prize: number | null;
  /** Race rating after this race (with `raceRating` before it); null until the result is public. */
  ratingAfter: number | null;
  mine: boolean;
  /** Owner's racing silks (null for house horses). */
  silks: Silks | null;
  /** The horse's saddle cloth, if its owner set one. */
  cloth: SaddleCloth | null;
  /** The owner's celebration if this horse wins (null for house horses). */
  finishEffect: FinishEffect | null;
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

/** Post-race report on one of the viewer's runs (information about a finished race only). */
export interface RaceReportDto {
  horseId: string;
  horseName: string;
  locked: boolean;
  priceGems: number;
  /** Owners' Circle members read reports for free. */
  member: boolean;
  report: {
    positions: number[];
    sectionals: { mine: number; best: number }[];
    topSpeed: number;
    energyAt75: number;
    energyAtFinish: number;
    blockedCount: number;
    insights: ReportInsight[];
    strategy: Strategy;
    gear: GearItem | null;
  } | null;
}

export interface LiveRaceDto {
  raceId: string;
  status: RaceStatus;
  /** Seconds since the start; frames are delivered up to this point. */
  elapsed: number;
  duration: number | null;
  distance: number;
  frames: { interval: number; ids: string[]; data: [number, number, number, number][][] } | null;
  /** `key`/`vars` are absent on races run before commentary became translatable. */
  commentary: {
    t: number;
    text: string;
    key?: string;
    vars?: { h: string; o1: string; o2: string; v?: number };
  }[];
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
  crest: Crest;
  member: boolean;
  reputation: number;
  earnings: number;
  wins: number;
}

export interface ShopHorseDto extends HorseSummaryDto {
  price: number;
  /** Limited-time listing (live-ops drop): gone from the shop after this. */
  limitedUntil?: string | null;
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
  /** Pinned at the top of the market until then (null when not featured). */
  featuredUntil: string | null;
  horse: ShopHorseDto;
}

export interface MarketListingDetailDto extends MarketListingDto {
  bids: { amount: number; bidderName: string | null; createdAt: string; mine: boolean }[];
  feeRate: number;
  /** Price and length of one featuring (for the seller's button). */
  feature: { gems: number; hours: number };
}

export const MakeOfferRequest = z.object({ amount: z.number().int().positive() }).strict();

export interface HorseOfferDto {
  id: string;
  horse: HorseSummaryDto;
  amount: number;
  status: "OPEN" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
  buyerName: string | null;
  sellerName: string | null;
  /** Seller's proceeds after the market fee. */
  net: number;
}

export interface OffersDto {
  received: HorseOfferDto[];
  made: HorseOfferDto[];
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
  crest: Crest;
  member: boolean;
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
  /** `house`: a house horse won a house-filled final (no owner is champion). */
  winner: { horseId: string; horseName: string; ownerName: string | null; house: boolean } | null;
  myEntries: TournamentEntryDto[];
  /** Runs with a single entrant; every heat and the final are made up with house horses. */
  houseFill: boolean;
  /** Why a cancelled tournament did not run (e.g. "Not enough entrants"); null otherwise. */
  cancelReason: string | null;
  completedAt: string | null;
}

/** One runner of a heat or the final, as it finished. House horses keep the field full. */
export interface TournamentRunnerDto {
  horseId: string;
  horseName: string;
  ownerId: string | null;
  ownerName: string | null;
  house: boolean;
  mine: boolean;
  gate: number | null;
  strategy: string;
  position: number | null;
  finishTime: number | null;
  lengthsBehind: number | null;
  prize: number | null;
  /** Heats: went through to the final. */
  qualified: boolean;
}

/** A heat or the final: the race and who ran in it. */
export interface TournamentRoundDto {
  raceId: string;
  stage: "HEAT" | "FINAL";
  /** Heat number (1-based); 0 for the final. */
  no: number;
  name: string;
  status: RaceStatus;
  startsAt: string;
  trackName: string;
  surface: string;
  distance: number;
  going: string;
  weather: string;
  runners: TournamentRunnerDto[];
}

/** The tournament table: finalists by their final placing, then the rest by how far they got. */
export interface TournamentStandingDto {
  /** Shared by horses that went out at the same stage with the same heat placing; null if scratched. */
  rank: number | null;
  tied: boolean;
  horseId: string;
  horseName: string;
  ownerId: string;
  ownerName: string | null;
  mine: boolean;
  status: TournamentEntryDto["status"];
  champion: boolean;
  heatNo: number | null;
  heatPosition: number | null;
  finalPosition: number | null;
  /** Credits won in the final (heats carry no purse). */
  prize: number;
}

export interface TournamentDetailDto extends TournamentDto {
  entries: TournamentEntryDto[];
  rounds: TournamentRoundDto[];
  standings: TournamentStandingDto[];
  /** What the champion's owner received besides the purse. */
  championHonours: { prestige: number; reputation: number };
}

export interface ProductDto {
  id: string;
  title: string;
  description: string;
  priceStars: number;
  grants: { gems?: number };
  /** Set for subscriptions: renews automatically every period (Telegram Stars subscription). */
  subscriptionDays?: number;
}

export type SubscriptionStatus = "ACTIVE" | "CANCELED" | "EXPIRED";

/** The viewer's Owners' Circle membership. */
export interface SubscriptionDto {
  productId: string;
  priceStars: number;
  periodDays: number;
  gemsPerPeriod: number;
  /** Null when the viewer never subscribed. */
  status: SubscriptionStatus | null;
  /** Member benefits apply (active, or cancelled but paid until periodEnd). */
  member: boolean;
  periodEnd: string | null;
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
  /** Set for an invited player who has not run yet: who invited them (stable name, if public). */
  invite?: { stable: string | null } | null;
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
  FeedPlan,
  GearItem,
  HorseStatus,
  RaceClass,
  RaceEventType,
  Rarity,
  Sex,
  Strategy,
  Surface,
  TrainingIntensity,
  TrainingType,
  Traits,
  Weather,
};
export { FEED_PLANS, GEAR_ITEMS, RACE_CLASSES, STRATEGIES, TRAINING_INTENSITIES, TRAINING_TYPES };
