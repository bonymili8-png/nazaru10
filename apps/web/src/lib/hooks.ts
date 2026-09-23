"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

const cache = new Map<string, unknown>();
const subscribers = new Map<string, Set<() => void>>();

/** Invalidate cached GETs whose path starts with any prefix; mounted hooks refetch. */
export function invalidate(...prefixes: string[]): void {
  for (const [key, subs] of subscribers) {
    if (prefixes.some((p) => key.startsWith(p))) subs.forEach((s) => s());
  }
}

/** Tiny stale-while-revalidate fetch hook (server state only; no client-side game logic). */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | undefined>(() =>
    path ? (cache.get(path) as T | undefined) : undefined,
  );
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path && !cache.has(path));
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      cache.set(path, d);
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e as Error);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    if (!path) return;
    setData(cache.get(path) as T | undefined);
    void load();
    const subs = subscribers.get(path) ?? new Set();
    subs.add(load);
    subscribers.set(path, subs);
    const timer = opts.refreshMs ? setInterval(() => void load(), opts.refreshMs) : null;
    return () => {
      alive.current = false;
      subs.delete(load);
      if (timer) clearInterval(timer);
    };
  }, [path, load, opts.refreshMs]);

  return { data, error, loading, reload: load };
}

/** Re-render every `ms` (countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
