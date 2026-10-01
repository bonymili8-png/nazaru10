import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, describeError, setAccessToken } from "../api/client";
import type { User } from "../api/types";
import { telegramInitData } from "../telegram";

const DEV_AUTH = import.meta.env.VITE_DEV_AUTH === "true";
const VEHICLE_KEY = "jlr.activeVehicle";

interface SessionState {
  user: User | null;
  error: string | null;
  loading: boolean;
  activeVehicleId: string | null;
  setActiveVehicleId(id: string | null): void;
  setProfessionalMode(enabled: boolean): Promise<void>;
  can(permission: string): boolean;
  retry(): void;
}

const SessionContext = createContext<SessionState | null>(null);

function readStoredVehicle(): string | null {
  try {
    return window.localStorage.getItem(VEHICLE_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [activeVehicleId, setActive] = useState<string | null>(readStoredVehicle);

  useEffect(() => {
    let cancelled = false;
    async function login() {
      setLoading(true);
      setError(null);
      try {
        const initData = telegramInitData();
        let token;
        if (initData) token = await api.loginTelegram(initData);
        else if (DEV_AUTH) token = await api.loginDev();
        else throw new Error("Open this app from Telegram to sign in.");
        if (cancelled) return;
        setAccessToken(token.access_token);
        setUser(token.user);
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void login();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const setActiveVehicleId = useCallback((id: string | null) => {
    setActive(id);
    try {
      if (id) window.localStorage.setItem(VEHICLE_KEY, id);
      else window.localStorage.removeItem(VEHICLE_KEY);
    } catch {
      // storage unavailable (private mode): keep in memory only
    }
  }, []);

  const setProfessionalMode = useCallback(async (enabled: boolean) => {
    setUser(await api.updateMe(enabled));
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      user,
      error,
      loading,
      activeVehicleId,
      setActiveVehicleId,
      setProfessionalMode,
      can: (permission: string) => Boolean(user?.permissions.includes(permission)),
      retry: () => setAttempt((n) => n + 1),
    }),
    [user, error, loading, activeVehicleId, setActiveVehicleId, setProfessionalMode],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
