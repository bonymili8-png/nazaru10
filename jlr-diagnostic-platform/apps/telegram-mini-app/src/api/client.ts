import type {
  AuditEntry,
  ClearDtcResult,
  ConnectResult,
  DtcEvent,
  DtcList,
  EcuRecord,
  GatewayStatus,
  LiveParameterDefinition,
  LiveSnapshot,
  OperationRecord,
  SafetyDecision,
  ScanResult,
  SessionSummary,
  TokenResponse,
  User,
  Vehicle,
  VehicleDetail,
} from "./types";

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api/v1";

/** A structured API error ({"error": {code, message, details, correlation_id}}). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly correlationId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "The server cannot be reached. Check your connection.");
  }
  if (!response.ok) {
    let payload: { error?: { code?: string; message?: string; details?: Record<string, unknown>; correlation_id?: string } } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // non-JSON error body
    }
    const error = payload.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? "HTTP_ERROR",
      error.message ?? `Request failed (${response.status})`,
      error.details ?? {},
      error.correlation_id ?? response.headers.get("X-Correlation-ID"),
    );
  }
  return (raw ? await response.text() : await response.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  loginTelegram: (initData: string) => request<TokenResponse>("POST", "/auth/telegram", { init_data: initData }),
  loginDev: () => request<TokenResponse>("POST", "/auth/dev", {}),
  me: () => request<User>("GET", "/me"),
  updateMe: (professionalMode: boolean) => request<User>("PATCH", "/me", { professional_mode: professionalMode }),
  gatewayStatus: () => request<GatewayStatus>("GET", "/gateway/status"),

  connect: () => request<ConnectResult>("POST", "/vehicles/connect"),
  disconnect: () => request<{ connected: boolean }>("POST", "/vehicles/disconnect"),
  vehicles: () => request<Vehicle[]>("GET", "/vehicles"),
  vehicle: (id: string) => request<VehicleDetail>("GET", `/vehicles/${enc(id)}`),
  scan: (id: string) => request<ScanResult>("POST", `/vehicles/${enc(id)}/scan`),
  sessions: (id: string) => request<SessionSummary[]>("GET", `/vehicles/${enc(id)}/sessions`),
  ecus: (id: string) => request<EcuRecord[]>("GET", `/vehicles/${enc(id)}/ecus`),
  dtcs: (id: string, query: Record<string, string> = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "")).toString();
    return request<DtcList>("GET", `/vehicles/${enc(id)}/dtcs${params ? `?${params}` : ""}`);
  },
  exportDtcsCsv: (id: string) => request<string>("GET", `/vehicles/${enc(id)}/dtcs/export.csv`, undefined, true),
  dtcEvents: (id: string) => request<DtcEvent[]>("GET", `/vehicles/${enc(id)}/dtc-events`),
  clearDtcs: (id: string, ecuId: string) =>
    request<ClearDtcResult>("POST", `/vehicles/${enc(id)}/dtcs/clear`, { ecu_id: ecuId, confirm: true }),
  safety: (id: string, operation: string, risk: SafetyDecision["risk"]) =>
    request<{ decision: SafetyDecision }>("POST", `/vehicles/${enc(id)}/safety`, { operation, risk }),
  liveParameters: (id: string) =>
    request<{ vin: string; parameters: LiveParameterDefinition[] }>("GET", `/vehicles/${enc(id)}/live-data/parameters`),
  readLive: (id: string, parameterIds: string[]) =>
    request<LiveSnapshot>("POST", `/vehicles/${enc(id)}/live-data`, { parameter_ids: parameterIds }),
  audit: () => request<AuditEntry[]>("GET", "/audit"),
  operations: () => request<OperationRecord[]>("GET", "/operations"),
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const hints: Record<string, string> = {
      NOT_CONNECTED: "The gateway is not connected to a vehicle. Connect first.",
      VIN_MISMATCH: "The gateway is connected to a different vehicle than the one selected.",
      GATEWAY_UNAVAILABLE: "The diagnostic gateway is not reachable.",
      OPERATION_IN_PROGRESS: "The vehicle bus is busy with another operation. Try again shortly.",
      RATE_LIMITED: "Too many requests. Wait a moment and try again.",
      PERMISSION_DENIED: "Your role does not allow this action.",
      AUTH_REQUIRED: "Your session has expired. Reopen the Mini App.",
    };
    return hints[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
