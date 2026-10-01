// Mirrors of the backend contracts (packages/shared-types and apps/api schemas).

export type CapabilityStatus =
  | "SUPPORTED"
  | "SUPPORTED_WITH_PREREQUISITES"
  | "HARDWARE_REQUIRED"
  | "OEM_AUTH_REQUIRED"
  | "UNKNOWN"
  | "NOT_SUPPORTED";

export type EvidenceSource =
  | "ECU_RESPONSE"
  | "ISO_STANDARD"
  | "USER_VERIFIED"
  | "SIMULATION"
  | "HEURISTIC"
  | "NONE";

export interface Capability {
  status: CapabilityStatus;
  source: EvidenceSource;
  evidence: string;
  prerequisites: string[];
}

export interface EcuCapabilities {
  read_dtc: Capability;
  clear_dtc: Capability;
  dtc_severity: Capability;
  freeze_frames: Capability;
  live_data: Capability;
  obd: Capability;
  extended_session: Capability;
  security_access: Capability;
  coding: Capability;
  adaptation: Capability;
  flashing: Capability;
  routines: string[];
}

export interface IdentificationValue {
  did: number;
  name: string;
  status: "READ" | "NOT_SUPPORTED" | "OEM_AUTH_REQUIRED" | "TIMEOUT" | "ERROR";
  raw_hex: string | null;
  text: string | null;
  nrc: number | null;
}

export interface EcuInfo {
  id: string;
  name: string;
  name_source: EvidenceSource;
  request_address: number;
  response_address: number;
  protocol: string;
  hardware_version: string | null;
  software_version: string | null;
  part_number: string | null;
  serial_number: string | null;
  vin: string | null;
  identification: IdentificationValue[];
  capabilities: EcuCapabilities;
  warnings: string[];
}

export interface DtcStatusFlags {
  test_failed: boolean;
  test_failed_this_operation_cycle: boolean;
  pending: boolean;
  confirmed: boolean;
  test_not_completed_since_last_clear: boolean;
  test_failed_since_last_clear: boolean;
  test_not_completed_this_operation_cycle: boolean;
  warning_indicator_requested: boolean;
}

export type DtcSeverity =
  | "CHECK_IMMEDIATELY"
  | "CHECK_AT_NEXT_HALT"
  | "MAINTENANCE_ONLY"
  | "WARNING_INDICATOR"
  | "NO_CLASS"
  | "UNKNOWN";

export interface FreezeFrame {
  record_number: number;
  raw_hex: string;
  identifiers: { did: string; data_hex: string }[];
  decoded: boolean;
  note: string | null;
}

export interface Dtc {
  ecu_id: string;
  ecu_name: string;
  code: string;
  display: string;
  raw: number;
  failure_type: number | null;
  failure_type_description: string | null;
  status_byte: number;
  status: DtcStatusFlags;
  description: string | null;
  description_source: EvidenceSource;
  severity: DtcSeverity;
  severity_source: EvidenceSource;
  occurrence_count: number | null;
  freeze_frames: FreezeFrame[];
  extended_data_hex: string | null;
  read_at: string;
}

export interface InterfaceStatus {
  kind: "mock" | "can" | "socketcan" | "doip" | "j2534";
  connected: boolean;
  simulation: boolean;
  description: string;
  vehicle_voltage: number | null;
  voltage_source: string;
  ignition: "ON" | "OFF" | "UNKNOWN";
  frames_sent: number;
  frames_received: number;
  errors: number;
  timeouts: number;
  last_error: string | null;
  protocols: string[];
}

export interface VinSource {
  ecu: string;
  method: string;
  vin: string;
}

export interface VehicleIdentity {
  vin: string | null;
  vin_valid_format: boolean;
  vin_check_digit_valid: boolean | null;
  sources: VinSource[];
  consistent: boolean;
  warnings: string[];
}

export interface ProfileFact {
  value: string | number | null;
  source: EvidenceSource;
  note: string | null;
}

export interface Vehicle {
  id: string;
  vin: string;
  make: string | null;
  model: string | null;
  model_year: number | null;
  display_name: string;
  simulation: boolean;
  profile: Record<string, unknown>;
  profile_schema_version: string;
  created_at: string;
  last_connected_at: string | null;
  last_scan_at: string | null;
}

export interface SessionSummary {
  id: string;
  kind: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  ecu_count: number;
  dtc_count: number;
  warnings: string[];
  error: Record<string, unknown> | null;
}

export interface VehicleDetail {
  vehicle: Vehicle;
  connected: boolean;
  gateway_vin: string | null;
  interface: InterfaceStatus | null;
  last_session: SessionSummary | null;
  ecu_count: number;
  dtc_count: number;
  active_dtc_count: number;
}

export interface ConnectResult {
  vehicle: Vehicle;
  identity: VehicleIdentity;
  interface: InterfaceStatus;
  connection_id: string;
}

export interface TraceEntry {
  t: number;
  ecu: string;
  direction: "TX" | "RX";
  hex: string;
  elapsed_ms: number;
}

export interface ScanResult {
  session_id: string;
  schema_version: string;
  vehicle: { vin: string | null; identity: VehicleIdentity; profile: Record<string, unknown> };
  ecus: EcuInfo[];
  dtcs: Dtc[];
  warnings: string[];
  duration_ms: number;
  probed_addresses: number;
  interface: InterfaceStatus;
  comparison: { appeared: string[]; resolved: string[]; status_changed: string[] };
  trace: TraceEntry[] | null;
}

export interface EcuRecord {
  ecu: EcuInfo;
  first_seen_at: string;
  last_seen_at: string;
  software_history: { recorded_at: string; hardware_version: string | null; software_version: string | null; part_number: string | null }[];
}

export interface DtcList {
  session_id: string | null;
  read_at: string | null;
  total: number;
  dtcs: Dtc[];
  groups: Record<string, Dtc[]> | null;
}

export interface DtcEvent {
  id: string;
  ecu_key: string;
  display: string;
  event: "APPEARED" | "RESOLVED" | "STATUS_CHANGED" | "CLEARED";
  details: Record<string, unknown>;
  occurred_at: string;
  session_id: string | null;
}

export interface SafetyDecision {
  operation: string;
  risk: "READ_ONLY" | "LOW_RISK_WRITE" | "CONFIGURATION_WRITE" | "FLASHING";
  verdict: string;
  allowed: boolean;
  reasons: string[];
  vehicle_voltage: number | null;
  ignition: string;
}

export interface ClearDtcResult {
  result: {
    ecu_id: string;
    cleared: boolean;
    dtcs_before: Dtc[];
    dtcs_after: Dtc[];
    safety: SafetyDecision;
    duration_ms: number;
  };
  audit_id: number;
}

export interface LiveParameterDefinition {
  id: string;
  ecu_id: string;
  name: string;
  unit: string;
  access: "OBD_MODE_01" | "UDS_DID";
  identifier: number;
  source: EvidenceSource;
  min_value: number | null;
  max_value: number | null;
}

export interface LiveParameterValue {
  id: string;
  ecu_id: string;
  name: string;
  unit: string;
  value: number | null;
  raw_hex: string | null;
  timestamp: string;
  status: "OK" | "NOT_AVAILABLE" | "TIMEOUT" | "ERROR";
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface LiveSnapshot {
  schema_version: string;
  vin: string | null;
  values: LiveParameterValue[];
  duration_ms: number;
}

export interface User {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: "viewer" | "technician" | "admin";
  professional_mode: boolean;
  permissions: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  vin: string | null;
  ecu: string | null;
  operation: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  request: Record<string, unknown>;
  response: Record<string, unknown> | null;
  result: "SUCCESS" | "FAILED" | "BLOCKED";
  error: { code: string; message: string } | null;
  software_version: string | null;
  correlation_id: string | null;
}

export interface OperationRecord {
  id: string;
  operation: string;
  status: "running" | "completed" | "failed";
  vehicle_id: string | null;
  session_id: string | null;
  ecu_key: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: { code: string; message: string } | null;
  correlation_id: string | null;
}

export interface GatewayStatus {
  reachable: boolean;
  interface: InterfaceStatus | null;
  vin: string | null;
  busy_with: string | null;
  simulation: boolean | null;
  catalogs: { name: string; version: string; source: string }[];
  protocols: Record<string, string>;
  error: { code: string; message: string } | null;
}
