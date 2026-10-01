"""Asynchronous UDS client over any request/response transport (ISO-TP on CAN, DoIP, ...).

Handles P2/P2* timing, ``0x78 responsePending``, suppressed positive responses and stale
responses, and exposes one method per ISO 14229-1 service the platform uses. It performs *no*
permission checks: the diagnostic core wraps it with an access policy before handing it to
application code (see ``jlr_diagnostic_core.access``).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from jlr_protocols.uds import codec
from jlr_protocols.uds.constants import (
    NEGATIVE_RESPONSE_SID,
    POSITIVE_RESPONSE_OFFSET,
    SUPPRESS_POSITIVE_RESPONSE,
    CommunicationControlType,
    DiagnosticSessionType,
    DtcReportType,
    ResetType,
    RoutineControlType,
    ServiceId,
)
from jlr_shared_types.errors import DiagnosticTimeoutError

# Services whose second byte is a sub-function (and can carry suppressPosRspMsgIndicationBit).
_SUBFUNCTION_SERVICES = frozenset(
    {
        ServiceId.DIAGNOSTIC_SESSION_CONTROL,
        ServiceId.ECU_RESET,
        ServiceId.READ_DTC_INFORMATION,
        ServiceId.SECURITY_ACCESS,
        ServiceId.COMMUNICATION_CONTROL,
        ServiceId.ROUTINE_CONTROL,
        ServiceId.TESTER_PRESENT,
    }
)
_MAX_STALE_RESPONSES = 4


class UdsTransport(Protocol):
    @property
    def label(self) -> str: ...

    async def send(self, payload: bytes) -> None: ...

    async def recv(self, timeout: float) -> bytes: ...


TraceHook = Callable[[dict[str, Any]], None]


@dataclass(frozen=True, slots=True)
class UdsTiming:
    p2: float = 0.15  # generous vs. the 50 ms server default: adapters and gateways add latency
    p2_star: float = 5.0
    max_response_pending: int = 30


class UdsClient:
    def __init__(
        self, transport: UdsTransport, timing: UdsTiming | None = None, trace: TraceHook | None = None
    ) -> None:
        self.transport = transport
        self.timing = timing or UdsTiming()
        self._trace = trace

    @property
    def label(self) -> str:
        return self.transport.label

    def _emit(self, direction: str, payload: bytes, started: float) -> None:
        if self._trace is not None:
            self._trace(
                {
                    "ecu": self.label,
                    "direction": direction,
                    "hex": payload.hex(" ").upper(),
                    "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
                }
            )

    async def request(self, payload: bytes) -> bytes:
        """Send a request and return the positive response (raises on negative response)."""

        service_id = payload[0]
        suppressed = (
            service_id in _SUBFUNCTION_SERVICES
            and len(payload) > 1
            and bool(payload[1] & SUPPRESS_POSITIVE_RESPONSE)
        )
        started = time.monotonic()
        self._emit("TX", payload, started)
        await self.transport.send(payload)
        if suppressed:
            return b""
        timeout = self.timing.p2
        pending = 0
        stale = 0
        while True:
            try:
                response = await self.transport.recv(timeout)
            except DiagnosticTimeoutError as exc:
                raise DiagnosticTimeoutError(
                    f"No response from ECU {self.label} to service 0x{service_id:02X}",
                    details={"ecu": self.label, "service_id": service_id, "pending_responses": pending},
                ) from exc
            self._emit("RX", response, started)
            if codec.is_response_pending(response, service_id):
                pending += 1
                if pending > self.timing.max_response_pending:
                    raise DiagnosticTimeoutError(
                        f"ECU {self.label} kept answering responsePending",
                        details={"ecu": self.label, "service_id": service_id},
                    )
                timeout = self.timing.p2_star
                continue
            answers_us = response[:1] == bytes([service_id + POSITIVE_RESPONSE_OFFSET]) or (
                len(response) >= 2 and response[0] == NEGATIVE_RESPONSE_SID and response[1] == service_id
            )
            if not answers_us and stale < _MAX_STALE_RESPONSES:
                stale += 1  # a late answer to an earlier, timed-out request: skip it
                continue
            return codec.check_response(service_id, response, ecu=self.label)

    # ---------------------------------------------------------------------------------- services

    async def diagnostic_session_control(self, session: DiagnosticSessionType | int) -> codec.SessionTiming:
        response = await self.request(codec.build_diagnostic_session_control(session))
        return codec.parse_diagnostic_session_control(response)

    async def ecu_reset(self, reset_type: ResetType | int) -> None:
        await self.request(codec.build_ecu_reset(reset_type))

    async def tester_present(self, *, suppress_response: bool = False) -> None:
        await self.request(codec.build_tester_present(suppress_response=suppress_response))

    async def communication_control(
        self, control: CommunicationControlType | int, communication_type: int
    ) -> None:
        await self.request(codec.build_communication_control(control, communication_type))

    async def clear_diagnostic_information(self, group: int = 0xFFFFFF) -> None:
        await self.request(codec.build_clear_diagnostic_information(group))

    async def read_dtc_count(self, status_mask: int = 0xFF) -> codec.DtcCount:
        response = await self.request(
            codec.build_read_dtc_information(DtcReportType.NUMBER_OF_DTC_BY_STATUS_MASK, status_mask)
        )
        return codec.parse_dtc_count(response)

    async def read_dtc_by_status(self, status_mask: int = 0xFF) -> tuple[int, list[codec.DtcStatusRecord]]:
        response = await self.request(
            codec.build_read_dtc_information(DtcReportType.DTC_BY_STATUS_MASK, status_mask)
        )
        return codec.parse_dtc_by_status(response)

    async def read_dtc_by_severity(
        self, severity_mask: int = 0xFF, status_mask: int = 0xFF
    ) -> tuple[int, list[codec.DtcSeverityRecord]]:
        response = await self.request(
            codec.build_read_dtc_information(
                DtcReportType.DTC_BY_SEVERITY_MASK_RECORD, severity_mask, status_mask
            )
        )
        return codec.parse_dtc_by_severity(response)

    async def read_dtc_snapshot(
        self, dtc: int, record_number: int = 0xFF, record_lengths: dict[int, int] | None = None
    ) -> codec.DtcSnapshotResponse:
        response = await self.request(
            codec.build_read_dtc_information(
                DtcReportType.DTC_SNAPSHOT_RECORD_BY_DTC_NUMBER, record_number, dtc=dtc
            )
        )
        return codec.parse_dtc_snapshot(response, record_lengths)

    async def read_dtc_extended_data(self, dtc: int, record_number: int = 0xFF) -> tuple[int, int, bytes]:
        response = await self.request(
            codec.build_read_dtc_information(
                DtcReportType.DTC_EXT_DATA_RECORD_BY_DTC_NUMBER, record_number, dtc=dtc
            )
        )
        return codec.parse_dtc_extended_data(response)

    async def read_data_by_identifier(self, did: int) -> bytes:
        response = await self.request(codec.build_read_data_by_identifier(did))
        return codec.parse_read_data_by_identifier(response, did)

    async def write_data_by_identifier(self, did: int, data: bytes) -> None:
        response = await self.request(codec.build_write_data_by_identifier(did, data))
        codec.parse_write_data_by_identifier(response, did)

    async def read_memory_by_address(
        self, address: int, size: int, address_bytes: int = 4, size_bytes: int = 2
    ) -> bytes:
        response = await self.request(
            codec.build_read_memory_by_address(address, size, address_bytes, size_bytes)
        )
        return response[1:]

    async def security_access_request_seed(self, level: int) -> bytes:
        response = await self.request(codec.build_security_access_request_seed(level))
        return codec.parse_security_access_seed(response)

    async def security_access_send_key(self, level: int, key: bytes) -> None:
        await self.request(codec.build_security_access_send_key(level, key))

    async def routine_control(
        self, control: RoutineControlType | int, routine_id: int, option: bytes = b""
    ) -> bytes:
        response = await self.request(codec.build_routine_control(control, routine_id, option))
        return codec.parse_routine_control(response, routine_id)

    async def request_download(self, address: int, size: int, *, data_format: int = 0) -> int:
        response = await self.request(codec.build_request_download(address, size, data_format=data_format))
        return codec.parse_max_block_length(response)

    async def request_upload(self, address: int, size: int, *, data_format: int = 0) -> int:
        response = await self.request(codec.build_request_upload(address, size, data_format=data_format))
        return codec.parse_max_block_length(response)

    async def transfer_data(self, block_sequence_counter: int, data: bytes = b"") -> bytes:
        response = await self.request(codec.build_transfer_data(block_sequence_counter, data))
        return response[2:]

    async def request_transfer_exit(self, parameters: bytes = b"") -> bytes:
        response = await self.request(codec.build_request_transfer_exit(parameters))
        return response[1:]
