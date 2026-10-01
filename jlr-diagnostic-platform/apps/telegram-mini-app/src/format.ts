import type { CapabilityStatus, Dtc, DtcSeverity, EvidenceSource, LiveParameterValue } from "./api/types";

export function hex(value: number, width = 3): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function dateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function voltage(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(2)} V`;
}

export function number(value: number | null, digits = 1): string {
  if (value === null) return "—";
  return Math.abs(value) >= 1000 ? Math.round(value).toLocaleString() : value.toFixed(digits).replace(/\.0+$/, "");
}

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  ECU_RESPONSE: "ECU response",
  ISO_STANDARD: "Standard",
  USER_VERIFIED: "Verified",
  SIMULATION: "Simulation",
  HEURISTIC: "Heuristic",
  NONE: "No evidence",
};

export const CAPABILITY_LABEL: Record<CapabilityStatus, string> = {
  SUPPORTED: "Supported",
  SUPPORTED_WITH_PREREQUISITES: "Needs prerequisites",
  HARDWARE_REQUIRED: "Hardware required",
  OEM_AUTH_REQUIRED: "OEM auth required",
  UNKNOWN: "Unknown",
  NOT_SUPPORTED: "Not supported",
};

export const SEVERITY_LABEL: Record<DtcSeverity, string> = {
  CHECK_IMMEDIATELY: "Check immediately",
  CHECK_AT_NEXT_HALT: "Check at next stop",
  MAINTENANCE_ONLY: "Maintenance",
  WARNING_INDICATOR: "Warning lamp on",
  NO_CLASS: "No class",
  UNKNOWN: "Severity unknown",
};

export type Tone = "ok" | "warn" | "bad" | "info" | "muted";

export function severityTone(severity: DtcSeverity): Tone {
  if (severity === "CHECK_IMMEDIATELY") return "bad";
  if (severity === "CHECK_AT_NEXT_HALT" || severity === "WARNING_INDICATOR") return "warn";
  if (severity === "MAINTENANCE_ONLY") return "info";
  return "muted";
}

export function dtcState(dtc: Dtc): { label: string; tone: Tone } {
  if (dtc.status.test_failed) return { label: "Active", tone: "bad" };
  if (dtc.status.pending) return { label: "Pending", tone: "warn" };
  if (dtc.status.confirmed) return { label: "Stored", tone: "info" };
  return { label: "Recorded", tone: "muted" };
}

export function capabilityTone(status: CapabilityStatus): Tone {
  switch (status) {
    case "SUPPORTED":
      return "ok";
    case "SUPPORTED_WITH_PREREQUISITES":
    case "HARDWARE_REQUIRED":
      return "warn";
    case "OEM_AUTH_REQUIRED":
    case "NOT_SUPPORTED":
      return "bad";
    default:
      return "muted";
  }
}

export function voltageTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined) return "muted";
  if (value < 11.5) return "bad";
  if (value < 12.2) return "warn";
  return "ok";
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`; // spreadsheet formula injection
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function liveRecordingCsv(samples: LiveParameterValue[]): string {
  const header = ["timestamp", "parameter_id", "ecu", "name", "value", "unit", "raw_hex", "status"];
  const rows = samples.map((s) => [s.timestamp, s.id, s.ecu_id, s.name, s.value, s.unit, s.raw_hex, s.status].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n") + "\n";
}

export function downloadText(filename: string, text: string, type = "text/csv"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
