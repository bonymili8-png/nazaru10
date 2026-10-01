import { useCallback, useEffect, useState } from "react";

import { describeError } from "../api/client";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): void;
}

interface Settled<T> {
  key: unknown[];
  data: T | null;
  error: string | null;
}

function sameKey(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Runs ``load`` on mount and whenever ``deps`` change. ``loading`` is derived (no state is set
 * synchronously inside the effect); results of superseded runs are ignored; the previous data stays
 * visible while a reload is in flight.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({ key: [], data: null, error: null });
  const key = [...deps, tick];

  useEffect(() => {
    let current = true;
    load()
      .then((data) => {
        if (current) setSettled({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (current) setSettled((prev) => ({ key, data: prev.data, error: describeError(e) }));
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, key);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data: settled.data, error: settled.error, loading: !sameKey(settled.key, key), reload };
}
