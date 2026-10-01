import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { liveRecordingCsv, timeAgo } from "../format";
import { VEHICLE_ID, VIN, dtc, ecu, iface, rpm, user, vehicle } from "./fixtures";

type Handler = (body: unknown) => { status?: number; body: unknown };
type Routes = Record<string, Handler>;

/** Fake backend: routes are "METHOD /path" (query string ignored); records every call. */
function mockApi(routes: Routes) {
  const calls: { key: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const key = `${init?.method ?? "GET"} ${url.pathname.replace("/api/v1", "")}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body, headers: (init?.headers ?? {}) as Record<string, string> });
      const handler = routes[key];
      if (!handler) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: key } }), { status: 404 });
      const result = handler(body);
      const text = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
      return new Response(text, { status: result.status ?? 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

const ok = (body: unknown): Handler => () => ({ body });

function baseRoutes(overrides: Routes = {}): Routes {
  return {
    "POST /auth/telegram": ok({ access_token: "tg-token", token_type: "bearer", expires_in: 3600, user }),
    "GET /gateway/status": ok({ reachable: true, interface: iface, vin: VIN, busy_with: null, simulation: true, catalogs: [], protocols: { uds: "ISO 14229-1" }, error: null }),
    [`GET /vehicles/${VEHICLE_ID}`]: ok({
      vehicle,
      connected: true,
      gateway_vin: VIN,
      interface: iface,
      last_session: null,
      ecu_count: 1,
      dtc_count: 1,
      active_dtc_count: 1,
    }),
    ...overrides,
  };
}

function signedInFromTelegram() {
  window.Telegram = { WebApp: { initData: "query_id=1&hash=abc", colorScheme: "dark", version: "8.0", platform: "ios", ready: vi.fn(), expand: vi.fn() } };
}

beforeEach(() => {
  signedInFromTelegram();
});

describe("sign-in", () => {
  it("exchanges Telegram initData for a token and never trusts the client for identity", async () => {
    const calls = mockApi(baseRoutes());
    render(<App />);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ key: "POST /auth/telegram", body: { init_data: "query_id=1&hash=abc" } });
    const gateway = calls.find((c) => c.key === "GET /gateway/status");
    expect(gateway?.headers.Authorization).toBe("Bearer tg-token");
  });

  it("explains that the app must be opened from Telegram", async () => {
    window.Telegram = undefined;
    mockApi(baseRoutes());
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Open this app from Telegram");
  });
});

describe("dashboard & connect", () => {
  it("connects, registers the vehicle from the VIN and shows its summary", async () => {
    const calls = mockApi(baseRoutes({ "POST /vehicles/connect": ok({ vehicle, identity: { vin: VIN }, interface: iface, connection_id: "c1" }) }));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /connect to vehicle|reconnect/i }));
    expect(await screen.findByLabelText("VIN")).toHaveTextContent(VIN);
    expect(screen.getByText("14.10 V")).toBeInTheDocument();
    expect(calls.some((c) => c.key === "POST /vehicles/connect")).toBe(true);
    expect(window.localStorage.getItem("jlr.activeVehicle")).toBe(VEHICLE_ID);
  });

  it("shows structured API errors", async () => {
    mockApi(
      baseRoutes({
        "POST /vehicles/connect": () => ({ status: 503, body: { error: { code: "GATEWAY_UNAVAILABLE", message: "x", details: {}, correlation_id: "c" } } }),
      }),
    );
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /connect to vehicle|reconnect/i }));
    expect(await screen.findByText("The diagnostic gateway is not reachable.")).toBeInTheDocument();
  });
});

describe("full scan", () => {
  it("runs a scan and lists the fault codes with evidence-based severity", async () => {
    window.localStorage.setItem("jlr.activeVehicle", VEHICLE_ID);
    window.location.hash = "#/scan";
    mockApi(
      baseRoutes({
        [`POST /vehicles/${VEHICLE_ID}/scan`]: ok({
          session_id: "s1",
          schema_version: "scan-result/1",
          vehicle: { vin: VIN, identity: { consistent: true }, profile: {} },
          ecus: [ecu],
          dtcs: [dtc],
          warnings: ["0x7A6: DTCs could not be read"],
          duration_ms: 1200,
          probed_addresses: 238,
          interface: iface,
          comparison: { appeared: ["0x7E0 P0171-00"], resolved: [], status_changed: [] },
          trace: null,
        }),
      }),
    );
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Start scan" }));
    expect(await screen.findByText("P0171-00")).toBeInTheDocument();
    expect(screen.getByText("System Too Lean (Bank 1)")).toBeInTheDocument();
    expect(screen.getByText("Check at next stop")).toBeInTheDocument();
    expect(screen.getByText("Warnings (1)")).toBeInTheDocument();
    expect(screen.getByText(/Simulation — data comes from a simulated vehicle/)).toBeInTheDocument();
  });
});

describe("DTC clear", () => {
  it("shows current/new/ECU/risk/voltage and only clears after explicit confirmation", async () => {
    window.localStorage.setItem("jlr.activeVehicle", VEHICLE_ID);
    window.location.hash = "#/dtcs";
    const calls = mockApi(
      baseRoutes({
        [`GET /vehicles/${VEHICLE_ID}/dtcs`]: ok({ session_id: "s1", read_at: "2026-10-01T08:01:00Z", total: 1, dtcs: [dtc], groups: null }),
        [`POST /vehicles/${VEHICLE_ID}/safety`]: ok({
          decision: { operation: "clear_dtc", risk: "LOW_RISK_WRITE", verdict: "ALLOWED", allowed: true, reasons: [], vehicle_voltage: 14.1, ignition: "ON" },
        }),
        [`GET /vehicles/${VEHICLE_ID}/ecus`]: ok([{ ecu, first_seen_at: "", last_seen_at: "", software_history: [] }]),
        [`POST /vehicles/${VEHICLE_ID}/dtcs/clear`]: ok({
          result: { ecu_id: "0x7E0", cleared: true, dtcs_before: [dtc], dtcs_after: [], safety: {}, duration_ms: 50 },
          audit_id: 7,
        }),
      }),
    );
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Clear…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Powertrain Control Module (0x7E0)")).toBeInTheDocument();
    expect(within(dialog).getByText("P0171-00")).toBeInTheDocument();
    expect(await within(dialog).findByText("14.10 V")).toBeInTheDocument();
    expect(within(dialog).getByText("S24.07.2")).toBeInTheDocument();
    expect(calls.some((c) => c.key.endsWith("/dtcs/clear"))).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear DTCs" }));
    expect(await screen.findByText(/Audit #7/)).toBeInTheDocument();
    expect(calls.find((c) => c.key.endsWith("/dtcs/clear"))?.body).toEqual({ ecu_id: "0x7E0", confirm: true });
  });

  it("disables the confirm button when the safety check blocks the operation", async () => {
    window.localStorage.setItem("jlr.activeVehicle", VEHICLE_ID);
    window.location.hash = "#/dtcs";
    mockApi(
      baseRoutes({
        [`GET /vehicles/${VEHICLE_ID}/dtcs`]: ok({ session_id: "s1", read_at: null, total: 1, dtcs: [dtc], groups: null }),
        [`POST /vehicles/${VEHICLE_ID}/safety`]: ok({
          decision: {
            operation: "clear_dtc",
            risk: "LOW_RISK_WRITE",
            verdict: "BLOCKED_LOW_VOLTAGE",
            allowed: false,
            reasons: ["Vehicle voltage 10.90 V is below 11.5 V required"],
            vehicle_voltage: 10.9,
            ignition: "ON",
          },
        }),
        [`GET /vehicles/${VEHICLE_ID}/ecus`]: ok([]),
      }),
    );
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Clear…" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/below 11.5 V/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Clear DTCs" })).toBeDisabled();
  });
});

describe("live data", () => {
  it("streams values for the selected parameters", async () => {
    window.localStorage.setItem("jlr.activeVehicle", VEHICLE_ID);
    window.location.hash = "#/live";
    mockApi(
      baseRoutes({
        [`GET /vehicles/${VEHICLE_ID}/live-data/parameters`]: ok({ vin: VIN, parameters: [rpm] }),
        [`POST /vehicles/${VEHICLE_ID}/live-data`]: ok({
          schema_version: "live-data/1",
          vin: VIN,
          duration_ms: 5,
          values: [{ id: rpm.id, ecu_id: "0x7E0", name: rpm.name, unit: "rpm", value: 812.5, raw_hex: "0CB2", timestamp: "2026-10-01T08:02:00Z", status: "OK", error: null, metadata: {} }],
        }),
      }),
    );
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("812.5")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("tab", { name: "Gauges" }));
    expect(screen.getByRole("img", { name: "Engine speed: 812.5 rpm" })).toBeInTheDocument();
  });
});

describe("formatting helpers", () => {
  it("exports recordings as CSV and neutralises formulas", () => {
    const csv = liveRecordingCsv([
      { id: "a", ecu_id: "0x7E0", name: "=cmd()", unit: "V", value: 1, raw_hex: null, timestamp: "t", status: "OK", error: null, metadata: {} },
    ]);
    expect(csv.split("\n")[0]).toBe("timestamp,parameter_id,ecu,name,value,unit,raw_hex,status");
    expect(csv).toContain("'=cmd()");
  });

  it("formats relative times", () => {
    const now = new Date("2026-10-01T10:00:00Z");
    expect(timeAgo(null)).toBe("never");
    expect(timeAgo("2026-10-01T09:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-10-01T09:30:00Z", now)).toBe("30 min ago");
  });
});
