/**
 * Server-side language for bot messages and notifications. The Mini App translates its own UI;
 * only texts the server sends straight to Telegram are localised here.
 */
export type Lang = "en" | "uk";

/** An explicit in-app choice wins; otherwise follow the Telegram client language. */
export const langOf = (languageCode: string | null | undefined, settingsLocale?: unknown): Lang => {
  if (settingsLocale === "en" || settingsLocale === "uk") return settingsLocale;
  return languageCode?.toLowerCase().startsWith("uk") ? "uk" : "en";
};

/** Ukrainian plural form: 1 кредит, 2 кредити, 5 кредитів. */
export const ukPlural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

export const num = (n: unknown, lang: Lang) => Number(n).toLocaleString(lang === "uk" ? "uk-UA" : "en");

export const ordinal = (n: number, lang: Lang) => {
  if (lang === "uk") return `${n}-м`;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "1 250 кредитів" / "1,250 credits". */
export const credits = (n: unknown, lang: Lang) =>
  lang === "uk"
    ? `${num(n, lang)} ${ukPlural(Number(n), "кредит", "кредити", "кредитів")}`
    : `${num(n, lang)} credits`;
