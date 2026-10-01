import type { Capability, Dtc, EcuInfo, InterfaceStatus, LiveParameterDefinition, User, Vehicle } from "../api/types";

export const VIN = "SALKA9AE6RA900101";
export const VEHICLE_ID = "11111111-1111-1111-1111-111111111111";

const cap = (status: Capability["status"]): Capability => ({ status, source: "ECU_RESPONSE", evidence: "test", prerequisites: [] });

export const user: User = {
  id: "u1",
  telegram_id: 1,
  username: "tech",
  first_name: "Tech",
  role: "technician",
  professional_mode: false,
  permissions: ["diagnostic:scan", "dtc:clear", "live_data:read", "vehicle:connect", "vehicle:read"],
};

export const iface: InterfaceStatus = {
  kind: "mock",
  connected: true,
  simulation: true,
  description: "Simulator",
  vehicle_voltage: 14.1,
  voltage_source: "SIMULATION",
  ignition: "ON",
  frames_sent: 10,
  frames_received: 10,
  errors: 0,
  timeouts: 0,
  last_error: null,
  protocols: [],
};

export const vehicle: Vehicle = {
  id: VEHICLE_ID,
  vin: VIN,
  make: "Land Rover",
  model: "Range Rover",
  model_year: 2024,
  display_name: "2024 Land Rover Range Rover",
  simulation: true,
  profile: { make: { value: "Land Rover", source: "ISO_STANDARD", note: null }, model: { value: "Range Rover", source: "SIMULATION", note: null } },
  profile_schema_version: "vehicle-profile/1",
  created_at: "2026-10-01T08:00:00Z",
  last_connected_at: "2026-10-01T08:00:00Z",
  last_scan_at: null,
};

export const ecu: EcuInfo = {
  id: "0x7E0",
  name: "Powertrain Control Module",
  name_source: "ECU_RESPONSE",
  request_address: 0x7e0,
  response_address: 0x7e8,
  protocol: "UDS/ISO-TP/CAN-11bit",
  hardware_version: "H3.1",
  software_version: "S24.07.2",
  part_number: "SIM-PCM",
  serial_number: null,
  vin: VIN,
  identification: [{ did: 0xf190, name: "VIN", status: "READ", raw_hex: "53", text: VIN, nrc: null }],
  capabilities: {
    read_dtc: cap("SUPPORTED"),
    clear_dtc: cap("UNKNOWN"),
    dtc_severity: cap("SUPPORTED"),
    freeze_frames: cap("SUPPORTED"),
    live_data: cap("SUPPORTED"),
    obd: cap("SUPPORTED"),
    extended_session: cap("UNKNOWN"),
    security_access: cap("OEM_AUTH_REQUIRED"),
    coding: cap("UNKNOWN"),
    adaptation: cap("UNKNOWN"),
    flashing: cap("UNKNOWN"),
    routines: [],
  },
  warnings: [],
};

export const dtc: Dtc = {
  ecu_id: "0x7E0",
  ecu_name: "Powertrain Control Module",
  code: "P0171",
  display: "P0171-00",
  raw: 0x017100,
  failure_type: 0,
  failure_type_description: "No sub type information",
  status_byte: 0xaf,
  status: {
    test_failed: true,
    test_failed_this_operation_cycle: true,
    pending: true,
    confirmed: true,
    test_not_completed_since_last_clear: false,
    test_failed_since_last_clear: true,
    test_not_completed_this_operation_cycle: false,
    warning_indicator_requested: true,
  },
  description: "System Too Lean (Bank 1)",
  description_source: "ISO_STANDARD",
  severity: "CHECK_AT_NEXT_HALT",
  severity_source: "ECU_RESPONSE",
  occurrence_count: 5,
  freeze_frames: [],
  extended_data_hex: null,
  read_at: "2026-10-01T08:01:00Z",
};

export const rpm: LiveParameterDefinition = {
  id: "0x7E0:obd:0C",
  ecu_id: "0x7E0",
  name: "Engine speed",
  unit: "rpm",
  access: "OBD_MODE_01",
  identifier: 0x0c,
  source: "ISO_STANDARD",
  min_value: 0,
  max_value: 16383.75,
};
