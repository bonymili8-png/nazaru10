/**
 * Plain constants and their types, with no zod: the web client imports these (its bundler
 * resolves `@thoroughline/contracts` here), so the UI never ships the request schemas.
 * Everything is re-exported from `index.ts` for the API.
 */
export { RACE_CLASSES, STRATEGIES, TRAINING_TYPES } from "@thoroughline/engine";

/**
 * A player-chosen name: Latin letters, digits, spaces and ' & . - only, starting with a letter or
 * digit; inner whitespace is collapsed. Shared by the client (live validation) and the API.
 */
export const LATIN_NAME = /^[A-Za-z0-9][A-Za-z0-9 '&.-]*$/;

export const NAME_LIMITS = { horse: 24, stable: 30 } as const;

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
  // Owners' Circle (subscription) exclusives.
  platinum: "#d9dce1",
  burgundy: "#7f1d3a",
  teal: "#0f9f95",
} as const;
export type SilkColor = keyof typeof SILK_COLORS;

/** Colours only Owners' Circle members may use (silks, crest, saddle cloths). */
export const MEMBER_COLORS: readonly SilkColor[] = ["platinum", "burgundy", "teal"];

export interface Silks {
  pattern: SilkPattern;
  primary: SilkColor;
  secondary: SilkColor;
}

/** Stable crest: an emblem shown beside the stable name (cosmetic only). */
export const CREST_SHAPES = ["SHIELD", "ROUND", "DIAMOND", "BANNER"] as const;
export type CrestShape = (typeof CREST_SHAPES)[number];
export const CREST_ICONS = [
  "HORSESHOE",
  "STAR",
  "CRESCENT",
  "CROWN",
  "LIGHTNING",
  "CLOVER",
  "GEM",
  "LAUREL",
] as const;
export type CrestIcon = (typeof CREST_ICONS)[number];

export interface Crest {
  shape: CrestShape;
  icon: CrestIcon;
  /** Field colour. */
  field: SilkColor;
  /** Emblem colour. */
  charge: SilkColor;
}

export const DEFAULT_CREST: Crest = { shape: "SHIELD", icon: "HORSESHOE", field: "black", charge: "gold" };

/** Saddle cloth: a per-horse colour scheme shown on its card and around its marker in races. */
export const CLOTH_PATTERNS = ["PLAIN", "STRIPE", "CHECK", "STARS"] as const;
export type ClothPattern = (typeof CLOTH_PATTERNS)[number];

export interface SaddleCloth {
  pattern: ClothPattern;
  color: SilkColor;
  trim: SilkColor;
}

/** Finish effect: the stable's celebration when one of its horses wins (cosmetic only). */
export const FINISH_EFFECTS = ["NONE", "CONFETTI", "FIREWORKS", "GOLD_RAIN", "ROSES", "LIGHTNING"] as const;
export type FinishEffect = (typeof FINISH_EFFECTS)[number];

export const LOCALES = ["en", "uk"] as const;
export type Locale = (typeof LOCALES)[number];

export const FEED_KINDS = ["WIN", "CHAMPION", "BIG_SALE", "FOAL", "SEASON_TOP", "CLUB_CREATED"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
