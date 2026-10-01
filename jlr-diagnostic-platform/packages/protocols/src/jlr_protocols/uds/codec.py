"""Pure UDS request builders and response parsers (ISO 14229-1).

Builders return the request PDU. Parsers take a *positive* response PDU (after
:func:`check_response`) and validate its structure; malformed responses raise ProtocolError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from jlr_protocols.uds.constants import (
    ALL_DTC_GROUPS,
    NEGATIVE_RESPONSE_SID,
    POSITIVE_RESPONSE_OFFSET,
    SUPPRESS_POSITIVE_RESPONSE,
    CommunicationControlType,
    DiagnosticSessionType,
    DtcReportType,
    Nrc,
    ResetType,
    RoutineControlType,
    ServiceId,
    nrc_name,
)
from jlr_shared_types.errors import NegativeResponseError, ProtocolError

# --------------------------------------------------------------------------------------------------
# Response classification
# --------------------------------------------------------------------------------------------------


def is_response_pending(response: bytes, service_id: int) -> bool:
    return (
        len(response) >= 3
        and response[0] == NEGATIVE_RESPONSE_SID
        and response[1] == service_id
        and response[2] == Nrc.RESPONSE_PENDING
    )


def check_response(service_id: int, response: bytes, *, ecu: str | None = None) -> bytes:
    """Raise NegativeResponseError for ``0x7F``; ProtocolError for anything not answering ``service_id``."""

    if not response:
        raise ProtocolError("Empty UDS response", details={"service_id": service_id, "ecu": ecu})
    if response[0] == NEGATIVE_RESPONSE_SID:
        if len(response) < 3:
            raise ProtocolError("Truncated negative response", details={"raw": response.hex(), "ecu": ecu})
        if response[1] != service_id:
            raise ProtocolError(
                f"Negative response for service 0x{response[1]:02X}, expected 0x{service_id:02X}",
                details={"raw": response.hex(), "ecu": ecu},
            )
        raise NegativeResponseError(service_id, response[2], nrc_name(response[2]), ecu=ecu)
    if response[0] != service_id + POSITIVE_RESPONSE_OFFSET:
        raise ProtocolError(
            f"Unexpected response SID 0x{response[0]:02X} to service 0x{service_id:02X}",
            details={"raw": response.hex(), "ecu": ecu},
        )
    return response


def _require_length(response: bytes, minimum: int, what: str) -> None:
    if len(response) < minimum:
        raise ProtocolError(f"{what}: response too short ({len(response)} < {minimum} bytes)")


# --------------------------------------------------------------------------------------------------
# 0x10 DiagnosticSessionControl
# --------------------------------------------------------------------------------------------------


def build_diagnostic_session_control(session: DiagnosticSessionType | int) -> bytes:
    return bytes([ServiceId.DIAGNOSTIC_SESSION_CONTROL, int(session)])


@dataclass(frozen=True, slots=True)
class SessionTiming:
    session: int
    p2_server_max: float  # seconds
    p2_star_server_max: float  # seconds


def parse_diagnostic_session_control(response: bytes) -> SessionTiming:
    _require_length(response, 2, "DiagnosticSessionControl")
    if len(response) >= 6:
        p2 = int.from_bytes(response[2:4], "big") / 1000
        p2_star = int.from_bytes(response[4:6], "big") * 10 / 1000
    else:  # some ECUs omit the timing record; fall back to the ISO default values
        p2, p2_star = 0.050, 5.0
    return SessionTiming(response[1] & 0x7F, p2, p2_star)


# --------------------------------------------------------------------------------------------------
# 0x11 ECUReset, 0x28 CommunicationControl, 0x3E TesterPresent
# --------------------------------------------------------------------------------------------------


def build_ecu_reset(reset_type: ResetType | int) -> bytes:
    return bytes([ServiceId.ECU_RESET, int(reset_type)])


def build_communication_control(control: CommunicationControlType | int, communication_type: int) -> bytes:
    return bytes([ServiceId.COMMUNICATION_CONTROL, int(control), communication_type & 0xFF])


def build_tester_present(*, suppress_response: bool = False) -> bytes:
    return bytes([ServiceId.TESTER_PRESENT, SUPPRESS_POSITIVE_RESPONSE if suppress_response else 0x00])


# --------------------------------------------------------------------------------------------------
# 0x14 ClearDiagnosticInformation
# --------------------------------------------------------------------------------------------------


def build_clear_diagnostic_information(group: int = ALL_DTC_GROUPS) -> bytes:
    if not 0 <= group <= 0xFFFFFF:
        raise ProtocolError("DTC group must be a 24-bit value")
    return bytes([ServiceId.CLEAR_DIAGNOSTIC_INFORMATION]) + group.to_bytes(3, "big")


# --------------------------------------------------------------------------------------------------
# 0x19 ReadDTCInformation
# --------------------------------------------------------------------------------------------------


def build_read_dtc_information(report: DtcReportType | int, *args: int, dtc: int | None = None) -> bytes:
    body = bytearray([ServiceId.READ_DTC_INFORMATION, int(report)])
    if dtc is not None:
        body += dtc.to_bytes(3, "big")
    body += bytes(a & 0xFF for a in args)
    return bytes(body)


@dataclass(frozen=True, slots=True)
class DtcCount:
    availability_mask: int
    format_identifier: int
    count: int


def parse_dtc_count(response: bytes) -> DtcCount:
    _require_length(response, 6, "ReadDTCInformation count")
    return DtcCount(response[2], response[3], int.from_bytes(response[4:6], "big"))


@dataclass(frozen=True, slots=True)
class DtcStatusRecord:
    dtc: int
    status: int


def parse_dtc_by_status(response: bytes) -> tuple[int, list[DtcStatusRecord]]:
    """Parse 0x59 0x02/0x0A: returns (availability mask, records)."""

    _require_length(response, 3, "ReadDTCInformation by status")
    body = response[3:]
    if len(body) % 4:
        raise ProtocolError(f"DTC list length {len(body)} is not a multiple of 4")
    records = [
        DtcStatusRecord(int.from_bytes(body[i : i + 3], "big"), body[i + 3]) for i in range(0, len(body), 4)
    ]
    return response[2], records


@dataclass(frozen=True, slots=True)
class DtcSeverityRecord:
    severity: int
    functional_unit: int
    dtc: int
    status: int


def parse_dtc_by_severity(response: bytes) -> tuple[int, list[DtcSeverityRecord]]:
    _require_length(response, 3, "ReadDTCInformation by severity")
    body = response[3:]
    if len(body) % 6:
        raise ProtocolError(f"DTC severity list length {len(body)} is not a multiple of 6")
    records = [
        DtcSeverityRecord(body[i], body[i + 1], int.from_bytes(body[i + 2 : i + 5], "big"), body[i + 5])
        for i in range(0, len(body), 6)
    ]
    return response[2], records


@dataclass(frozen=True, slots=True)
class SnapshotRecord:
    record_number: int
    identifier_count: int
    raw: bytes


@dataclass(frozen=True, slots=True)
class DtcSnapshotResponse:
    dtc: int
    status: int
    records: list[SnapshotRecord] = field(default_factory=list)


def parse_dtc_snapshot(response: bytes, record_lengths: dict[int, int] | None = None) -> DtcSnapshotResponse:
    """Parse 0x59 0x04.

    Snapshot record contents are ``DID + data`` tuples whose data lengths are only known from the
    ECU's diagnostic description. Without ``record_lengths`` (record number -> payload length) the
    response can only be split unambiguously when it carries a single record, which is what the
    caller gets: one :class:`SnapshotRecord` with the remaining bytes.
    """

    _require_length(response, 6, "ReadDTCInformation snapshot")
    dtc = int.from_bytes(response[2:5], "big")
    status = response[5]
    body = response[6:]
    records: list[SnapshotRecord] = []
    offset = 0
    while offset < len(body):
        if offset + 2 > len(body):
            raise ProtocolError("Truncated snapshot record header")
        record_number, identifier_count = body[offset], body[offset + 1]
        offset += 2
        length = (record_lengths or {}).get(record_number)
        if length is None:
            records.append(SnapshotRecord(record_number, identifier_count, body[offset:]))
            break
        records.append(SnapshotRecord(record_number, identifier_count, body[offset : offset + length]))
        offset += length
    return DtcSnapshotResponse(dtc, status, records)


def parse_dtc_extended_data(response: bytes) -> tuple[int, int, bytes]:
    """Parse 0x59 0x06: (dtc, status, raw extended data records)."""

    _require_length(response, 6, "ReadDTCInformation extended data")
    return int.from_bytes(response[2:5], "big"), response[5], response[6:]


# --------------------------------------------------------------------------------------------------
# 0x22 ReadDataByIdentifier / 0x2E WriteDataByIdentifier
# --------------------------------------------------------------------------------------------------


def build_read_data_by_identifier(*dids: int) -> bytes:
    if not dids:
        raise ProtocolError("ReadDataByIdentifier needs at least one DID")
    body = bytearray([ServiceId.READ_DATA_BY_IDENTIFIER])
    for did in dids:
        if not 0 <= did <= 0xFFFF:
            raise ProtocolError(f"DID 0x{did:X} is not a 16-bit value")
        body += did.to_bytes(2, "big")
    return bytes(body)


def parse_read_data_by_identifier(response: bytes, did: int) -> bytes:
    """Data record of a single-DID response."""

    _require_length(response, 3, "ReadDataByIdentifier")
    echoed = int.from_bytes(response[1:3], "big")
    if echoed != did:
        raise ProtocolError(f"ReadDataByIdentifier echoed DID 0x{echoed:04X}, expected 0x{did:04X}")
    return response[3:]


def build_write_data_by_identifier(did: int, data: bytes) -> bytes:
    return bytes([ServiceId.WRITE_DATA_BY_IDENTIFIER]) + did.to_bytes(2, "big") + data


def parse_write_data_by_identifier(response: bytes, did: int) -> None:
    _require_length(response, 3, "WriteDataByIdentifier")
    if int.from_bytes(response[1:3], "big") != did:
        raise ProtocolError("WriteDataByIdentifier echoed a different DID")


# --------------------------------------------------------------------------------------------------
# 0x23 ReadMemoryByAddress, 0x34/0x35/0x36/0x37 transfer services
# --------------------------------------------------------------------------------------------------


def _address_and_length(address: int, size: int, address_bytes: int, size_bytes: int) -> bytes:
    if not (1 <= address_bytes <= 15 and 1 <= size_bytes <= 15):
        raise ProtocolError("addressAndLengthFormatIdentifier nibbles must be 1..15")
    if address >= 1 << (8 * address_bytes) or size >= 1 << (8 * size_bytes):
        raise ProtocolError("Address or size does not fit the declared format")
    return (
        bytes([(size_bytes << 4) | address_bytes])
        + address.to_bytes(address_bytes, "big")
        + size.to_bytes(size_bytes, "big")
    )


def build_read_memory_by_address(
    address: int, size: int, address_bytes: int = 4, size_bytes: int = 2
) -> bytes:
    return bytes([ServiceId.READ_MEMORY_BY_ADDRESS]) + _address_and_length(
        address, size, address_bytes, size_bytes
    )


def build_request_download(
    address: int, size: int, *, data_format: int = 0x00, address_bytes: int = 4, size_bytes: int = 4
) -> bytes:
    return bytes([ServiceId.REQUEST_DOWNLOAD, data_format]) + _address_and_length(
        address, size, address_bytes, size_bytes
    )


def build_request_upload(
    address: int, size: int, *, data_format: int = 0x00, address_bytes: int = 4, size_bytes: int = 4
) -> bytes:
    return bytes([ServiceId.REQUEST_UPLOAD, data_format]) + _address_and_length(
        address, size, address_bytes, size_bytes
    )


def parse_max_block_length(response: bytes) -> int:
    """maxNumberOfBlockLength from a RequestDownload/RequestUpload positive response."""

    _require_length(response, 3, "RequestDownload/Upload")
    width = response[1] >> 4
    if width == 0 or len(response) < 2 + width:
        raise ProtocolError("Invalid lengthFormatIdentifier")
    return int.from_bytes(response[2 : 2 + width], "big")


def build_transfer_data(block_sequence_counter: int, data: bytes) -> bytes:
    return bytes([ServiceId.TRANSFER_DATA, block_sequence_counter & 0xFF]) + data


def build_request_transfer_exit(parameters: bytes = b"") -> bytes:
    return bytes([ServiceId.REQUEST_TRANSFER_EXIT]) + parameters


# --------------------------------------------------------------------------------------------------
# 0x27 SecurityAccess
# --------------------------------------------------------------------------------------------------


def build_security_access_request_seed(level: int) -> bytes:
    if level % 2 == 0 or not 0x01 <= level <= 0x7D:
        raise ProtocolError("requestSeed sub-functions are odd values 0x01..0x7D")
    return bytes([ServiceId.SECURITY_ACCESS, level])


def build_security_access_send_key(level: int, key: bytes) -> bytes:
    if level % 2 == 0 or not 0x01 <= level <= 0x7D:
        raise ProtocolError("Pass the requestSeed level; sendKey uses level + 1")
    return bytes([ServiceId.SECURITY_ACCESS, level + 1]) + key


def parse_security_access_seed(response: bytes) -> bytes:
    _require_length(response, 2, "SecurityAccess requestSeed")
    return response[2:]


# --------------------------------------------------------------------------------------------------
# 0x31 RoutineControl
# --------------------------------------------------------------------------------------------------


def build_routine_control(control: RoutineControlType | int, routine_id: int, option: bytes = b"") -> bytes:
    return bytes([ServiceId.ROUTINE_CONTROL, int(control)]) + routine_id.to_bytes(2, "big") + option


def parse_routine_control(response: bytes, routine_id: int) -> bytes:
    _require_length(response, 4, "RoutineControl")
    if int.from_bytes(response[2:4], "big") != routine_id:
        raise ProtocolError("RoutineControl echoed a different routine identifier")
    return response[4:]
