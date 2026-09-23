import type { ApiError, AuthResponse } from "@thoroughline/contracts";

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN_KEY = "tl.token";

let token: string | null = null;

export function getToken(): string | null {
  if (token) return token;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}

export function setToken(t: string | null): void {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — keep it in memory */
  }
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (l: Listener) => {
  unauthorizedListeners.add(l);
  return () => {
    unauthorizedListeners.delete(l);
  };
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(t ? { authorization: `Bearer ${t}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Can't reach the stable — check your connection and retry.");
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    if (res.status === 401) {
      setToken(null);
      unauthorizedListeners.forEach((l) => l());
    }
    throw new ApiRequestError(
      res.status,
      err?.code ?? "HTTP_ERROR",
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export async function loginWithTelegram(initData: string): Promise<AuthResponse> {
  const r = await post<AuthResponse>("/auth/telegram", { initData });
  setToken(r.token);
  return r;
}

export async function loginDev(telegramId: number, firstName: string): Promise<AuthResponse> {
  const r = await post<AuthResponse>("/auth/dev", { telegramId, firstName });
  setToken(r.token);
  return r;
}
