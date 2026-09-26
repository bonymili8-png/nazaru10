import { getLocale, type MessageKey, t } from "./i18n";
import { en } from "./i18n/en";

export const fmt = (n: number) =>
  new Intl.NumberFormat(getLocale() === "uk" ? "uk-UA" : "en").format(Math.round(n));

export function countdown(targetIso: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(targetIso).getTime() - now) / 1000));
  const [d, h, m, sec] = [t("time.d"), t("time.h"), t("time.m"), t("time.s")];
  const sp = getLocale() === "uk" ? " " : "";
  if (s >= 2 * 86400) return `${Math.floor(s / 86400)}${sp}${d} ${Math.floor((s % 86400) / 3600)}${sp}${h}`;
  if (s >= 3600) return `${Math.floor(s / 3600)}${sp}${h} ${Math.floor((s % 3600) / 60)}${sp}${m}`;
  if (s >= 60) return `${Math.floor(s / 60)}${sp}${m} ${String(s % 60).padStart(2, "0")}${sp}${sec}`;
  return `${s}${sp}${sec}`;
}

export const ordinal = (n: number) => {
  if (getLocale() === "uk") return `${n}-й`;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export const has = (key: string): key is MessageKey => {
  const v = t(key as MessageKey);
  return v !== key;
};

/** Track archetypes ("Urban Track") share the enum dictionary. */
export const trackName = (archetype: string) => titleCase(archetype.replace(/ /g, "_"));

/** Human label for an enum value: the dictionary entry when there is one, else Title Case. */
export const titleCase = (s: string) =>
  has(`enum.${s.toUpperCase()}`)
    ? t(`enum.${s.toUpperCase()}` as MessageKey)
    : s
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

/** Label maps resolved in the active locale at read time (same shape as before i18n). */
/**
 * A label map translated at read time. Pass `keys` when callers iterate it (Object.entries…):
 * a proxy only enumerates the keys its target has.
 */
const lookup = <T>(make: (k: string) => T, keys: readonly string[] = []) =>
  new Proxy(Object.fromEntries(keys.map((k) => [k, undefined])) as Record<string, T>, {
    get: (_, k) => make(String(k)),
  });

export const CLASS_NAMES = lookup((k) => t(`class.${k}` as MessageKey));
export const STRATEGY_INFO = lookup((k) => ({
  label: t(`strategy.${k}` as MessageKey),
  hint: t(`strategy.${k}.hint` as MessageKey),
}));
export const TRAINING_INFO = lookup((k) => ({
  label: t(`training.${k}` as MessageKey),
  focus: t(`training.${k}.focus` as MessageKey),
}));
const ATTRIBUTES = Object.keys(en)
  .filter((k) => k.startsWith("attr."))
  .map((k) => k.slice("attr.".length));
export const ATTRIBUTE_LABELS = lookup((k) => t(`attr.${k}` as MessageKey), ATTRIBUTES);

/** Localised message for an API error (by code), falling back to the server text. */
export const errorMessage = (e: unknown): string => {
  const err = e as { code?: string; message?: string; details?: { currency?: string } };
  if (err?.code === "NETWORK") return t("error.network");
  // Some codes have a more specific variant, e.g. INSUFFICIENT_FUNDS for a given currency.
  const specific = `error.${err?.code ?? ""}.${err?.details?.currency ?? ""}`;
  if (err?.details?.currency && has(specific)) return t(specific);
  const key = `error.${err?.code ?? ""}`;
  return err?.code && has(key) ? t(key as MessageKey) : (err?.message ?? t("state.error"));
};
