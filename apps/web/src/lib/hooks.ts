"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

const cache = new Map<string, unknown>();
/** When each path was last fetched, so a remount right after a fetch reuses it. */
const fetchedAt = new Map<string, number>();
/** Requests in flight: components asking for the same path at once share one request. */
const inflight = new Map<string, Promise<unknown>>();
const subscribers = new Map<string, Set<() => void>>();
/** Data younger than this is shown without refetching on mount (back navigation, tab switches). */
const FRESH_MS = 3_000;

function fetchShared<T>(path: string): Promise<T> {
  let p = inflight.get(path) as Promise<T> | undefined;
  if (!p) {
    p = api<T>(path)
      .then((d) => {
        cache.set(path, d);
        fetchedAt.set(path, Date.now());
        return d;
      })
      .finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  return p;
}

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** Invalidate cached GETs whose path starts with any prefix; mounted hooks refetch. */
export function invalidate(...prefixes: string[]): void {
  for (const key of fetchedAt.keys()) if (prefixes.some((p) => key.startsWith(p))) fetchedAt.delete(key);
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
      const d = await fetchShared<T>(path);
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
    if (Date.now() - (fetchedAt.get(path) ?? 0) > FRESH_MS) void load();
    else setLoading(false);
    const subs = subscribers.get(path) ?? new Set();
    subs.add(load);
    subscribers.set(path, subs);
    // Polling pauses while the Mini App is in the background, and catches up when it returns.
    const timer = opts.refreshMs ? setInterval(() => !hidden() && void load(), opts.refreshMs) : null;
    const onVisible = () => {
      if (!hidden() && opts.refreshMs && Date.now() - (fetchedAt.get(path) ?? 0) > opts.refreshMs) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      subs.delete(load);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
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
