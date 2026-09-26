"use client";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { en, type MessageKey, type Msg, type Vars } from "./en";
import { uk } from "./uk";

export type Locale = "en" | "uk";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "uk", label: "Українська" },
];

const DICTS: Record<Locale, Record<MessageKey, Msg>> = { en, uk };
const STORAGE_KEY = "tl.locale";

/**
 * The active locale lives at module level so plain helpers (t, fmt, countdown…) can use it without
 * hooks; the provider re-mounts the app content when it changes.
 */
let current: Locale = "en";

export const getLocale = (): Locale => current;

export function t(key: MessageKey, vars: Vars = {}): string {
  const msg = DICTS[current][key] ?? (en as Record<string, Msg>)[key];
  if (msg === undefined) return key;
  const text = typeof msg === "function" ? msg(vars) : msg;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export { ukPlural } from "./plural";

function detect(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "uk") return stored;
  } catch {
    /* storage unavailable */
  }
  const tgLang =
    typeof window !== "undefined" ? window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code : undefined;
  const lang = (tgLang ?? (typeof navigator !== "undefined" ? navigator.language : "en")).toLowerCase();
  return lang.startsWith("uk") ? "uk" : "en";
}

const Ctx = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: "en",
  setLocale: () => undefined,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Starts as "en" to match the pre-rendered HTML, then switches after mount.
  const [locale, setState] = useState<Locale>("en");
  current = locale;
  useEffect(() => {
    const l = detect();
    current = l;
    document.documentElement.lang = l;
    setState(l);
  }, []);
  const setLocale = useCallback((l: Locale) => {
    current = l;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.lang = l;
    setState(l);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLocale = () => useContext(Ctx);
export type { MessageKey };
