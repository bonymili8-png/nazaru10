"""Diagnostics over IP (ISO 13400-2): message codec and an asynchronous TCP client.

Covers the generic header, vehicle identification, routing activation, alive check and diagnostic
messages with their (N)ACKs — the subset an external test equipment needs to run UDS against a DoIP
entity. TLS (ISO 13400-2:2019, port 3496) and OEM-specific routing activation authentication are
out of scope; activation types that require OEM authentication are reported, not bypassed.
"""

from __future__ import annotations

import asyncio
import contextlib
import struct
from dataclasses import dataclass
from enum import IntEnum

from jlr_shared_types.errors import (
    DiagnosticConnectionError,
    DiagnosticTimeoutError,
    ProtocolError,
    SecurityAccessRequiredError,
)

DOIP_PORT = 13400
HEADER = struct.Struct(">BBHI")
DEFAULT_TESTER_ADDRESS = 0x0E00  # ISO 13400-2: 0x0E00-0x0FFF external test equipment
MAX_PAYLOAD = 0x0400_0000


class ProtocolVersion(IntEnum):
    ISO_13400_2010 = 0x01
    ISO_13400_2012 = 0x02
    ISO_13400_2019 = 0x03
    DEFAULT = 0xFF  # vehicle identification requests only


class PayloadType(IntEnum):
    GENERIC_NACK = 0x0000
    VEHICLE_IDENTIFICATION_REQUEST = 0x0001
    VEHICLE_IDENTIFICATION_REQUEST_EID = 0x0002
    VEHICLE_IDENTIFICATION_REQUEST_VIN = 0x0003
    VEHICLE_ANNOUNCEMENT = 0x0004
    ROUTING_ACTIVATION_REQUEST = 0x0005
    ROUTING_ACTIVATION_RESPONSE = 0x0006
    ALIVE_CHECK_REQUEST = 0x0007
    ALIVE_CHECK_RESPONSE = 0x0008
    ENTITY_STATUS_REQUEST = 0x4001
    ENTITY_STATUS_RESPONSE = 0x4002
    POWER_MODE_REQUEST = 0x4003
    POWER_MODE_RESPONSE = 0x4004
    DIAGNOSTIC_MESSAGE = 0x8001
    DIAGNOSTIC_MESSAGE_ACK = 0x8002
    DIAGNOSTIC_MESSAGE_NACK = 0x8003


class RoutingActivationCode(IntEnum):
    DENIED_UNKNOWN_SOURCE = 0x00
    DENIED_ALL_SOCKETS_REGISTERED = 0x01
    DENIED_SA_DIFFERENT = 0x02
    DENIED_SA_ALREADY_ACTIVE = 0x03
    DENIED_MISSING_AUTHENTICATION = 0x04
    DENIED_REJECTED_CONFIRMATION = 0x05
    DENIED_UNSUPPORTED_ACTIVATION_TYPE = 0x06
    DENIED_TLS_REQUIRED = 0x07
    SUCCESS = 0x10
    SUCCESS_CONFIRMATION_REQUIRED = 0x11


DIAGNOSTIC_NACK_REASONS = {
    0x02: "invalid source address",
    0x03: "unknown target address",
    0x04: "diagnostic message too large",
    0x05: "out of memory",
    0x06: "target unreachable",
    0x07: "unknown network",
    0x08: "transport protocol error",
}


@dataclass(frozen=True, slots=True)
class DoIPMessage:
    payload_type: int
    payload: bytes
    version: int = ProtocolVersion.ISO_13400_2012

    def encode(self) -> bytes:
        return (
            HEADER.pack(self.version, self.version ^ 0xFF, self.payload_type, len(self.payload))
            + self.payload
        )


def decode_header(header: bytes) -> tuple[int, int, int]:
    """Validate a generic DoIP header and return (version, payload_type, payload_length)."""

    if len(header) != HEADER.size:
        raise ProtocolError("Truncated DoIP header")
    version, inverse, payload_type, length = HEADER.unpack(header)
    if version ^ 0xFF != inverse:
        raise ProtocolError("DoIP protocol version / inverse mismatch")
    if length > MAX_PAYLOAD:
        raise ProtocolError(f"DoIP payload length {length} exceeds the supported maximum")
    return version, payload_type, length


def decode_message(data: bytes) -> DoIPMessage:
    version, payload_type, length = decode_header(data[: HEADER.size])
    payload = data[HEADER.size :]
    if len(payload) != length:
        raise ProtocolError("DoIP payload length mismatch")
    return DoIPMessage(payload_type, payload, version)


def routing_activation_request(source_address: int, activation_type: int = 0x00) -> bytes:
    return struct.pack(">HB", source_address, activation_type) + b"\x00" * 4


@dataclass(frozen=True, slots=True)
class RoutingActivationResponse:
    tester_address: int
    entity_address: int
    code: int


def parse_routing_activation_response(payload: bytes) -> RoutingActivationResponse:
    if len(payload) < 9:
        raise ProtocolError("Truncated routing activation response")
    tester, entity, code = struct.unpack(">HHB", payload[:5])
    return RoutingActivationResponse(tester, entity, code)


def diagnostic_message(source: int, target: int, user_data: bytes) -> bytes:
    return struct.pack(">HH", source, target) + user_data


def parse_diagnostic_message(payload: bytes) -> tuple[int, int, bytes]:
    if len(payload) < 4:
        raise ProtocolError("Truncated diagnostic message")
    source, target = struct.unpack(">HH", payload[:4])
    return source, target, payload[4:]


@dataclass(frozen=True, slots=True)
class VehicleAnnouncement:
    vin: str
    logical_address: int
    eid: bytes
    gid: bytes
    further_action: int


def parse_vehicle_announcement(payload: bytes) -> VehicleAnnouncement:
    if len(payload) < 32:
        raise ProtocolError("Truncated vehicle announcement")
    vin = payload[:17].decode("ascii", errors="replace")
    (logical,) = struct.unpack(">H", payload[17:19])
    return VehicleAnnouncement(vin, logical, payload[19:25], payload[25:31], payload[31])


class DoIPClient:
    """One TCP connection to a DoIP entity with routing activated for one tester address."""

    def __init__(
        self,
        host: str,
        port: int = DOIP_PORT,
        *,
        tester_address: int = DEFAULT_TESTER_ADDRESS,
        activation_type: int = 0x00,
        version: int = ProtocolVersion.ISO_13400_2012,
        connect_timeout: float = 3.0,
    ) -> None:
        self.host = host
        self.port = port
        self.tester_address = tester_address
        self.activation_type = activation_type
        self.version = version
        self.connect_timeout = connect_timeout
        self.entity_address: int | None = None
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._inbox: dict[int, asyncio.Queue[bytes]] = {}
        self._acks: asyncio.Queue[tuple[int, int, int]] = asyncio.Queue()
        self._reader_task: asyncio.Task[None] | None = None
        self._failure: Exception | None = None
        self._send_lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        return self._writer is not None and self._failure is None

    async def connect(self) -> RoutingActivationResponse:
        try:
            async with asyncio.timeout(self.connect_timeout):
                self._reader, self._writer = await asyncio.open_connection(self.host, self.port)
        except (OSError, TimeoutError) as exc:
            raise DiagnosticConnectionError(
                f"Cannot reach DoIP entity {self.host}:{self.port}: {exc}"
            ) from exc
        await self._write(
            PayloadType.ROUTING_ACTIVATION_REQUEST,
            routing_activation_request(self.tester_address, self.activation_type),
        )
        message = await self._read_message(self.connect_timeout)
        if message.payload_type != PayloadType.ROUTING_ACTIVATION_RESPONSE:
            await self.close()
            raise ProtocolError(f"Expected routing activation response, got 0x{message.payload_type:04X}")
        response = parse_routing_activation_response(message.payload)
        if response.code in (
            RoutingActivationCode.DENIED_MISSING_AUTHENTICATION,
            RoutingActivationCode.DENIED_REJECTED_CONFIRMATION,
            RoutingActivationCode.DENIED_TLS_REQUIRED,
        ):
            await self.close()
            raise SecurityAccessRequiredError(
                "DoIP entity requires authenticated routing activation (OEM_AUTH_REQUIRED)",
                details={"activation_code": response.code},
            )
        if response.code not in (
            RoutingActivationCode.SUCCESS,
            RoutingActivationCode.SUCCESS_CONFIRMATION_REQUIRED,
        ):
            await self.close()
            raise DiagnosticConnectionError(
                f"DoIP routing activation denied (code 0x{response.code:02X})",
                details={"activation_code": response.code},
            )
        self.entity_address = response.entity_address
        self._reader_task = asyncio.create_task(self._read_loop(), name="doip-reader")
        return response

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader_task
            self._reader_task = None
        if self._writer is not None:
            self._writer.close()
            with contextlib.suppress(OSError, ConnectionError):
                await self._writer.wait_closed()
        self._reader = self._writer = None

    async def _write(self, payload_type: int, payload: bytes) -> None:
        if self._writer is None:
            raise DiagnosticConnectionError("DoIP connection is not open")
        self._writer.write(DoIPMessage(payload_type, payload, self.version).encode())
        try:
            await self._writer.drain()
        except (OSError, ConnectionError) as exc:
            raise DiagnosticConnectionError(f"DoIP write failed: {exc}") from exc

    async def _read_message(self, timeout: float | None = None) -> DoIPMessage:
        if self._reader is None:
            raise DiagnosticConnectionError("DoIP connection is not open")
        try:
            async with asyncio.timeout(timeout):
                header = await self._reader.readexactly(HEADER.size)
                version, payload_type, length = decode_header(header)
                payload = await self._reader.readexactly(length)
        except TimeoutError as exc:
            raise DiagnosticTimeoutError("No DoIP message within timeout") from exc
        except (asyncio.IncompleteReadError, OSError, ConnectionError) as exc:
            raise DiagnosticConnectionError(f"DoIP connection lost: {exc}") from exc
        return DoIPMessage(payload_type, payload, version)

    async def _read_loop(self) -> None:
        try:
            while True:
                message = await self._read_message()
                if message.payload_type == PayloadType.DIAGNOSTIC_MESSAGE:
                    source, _target, data = parse_diagnostic_message(message.payload)
                    self._inbox.setdefault(source, asyncio.Queue()).put_nowait(data)
                elif message.payload_type in (
                    PayloadType.DIAGNOSTIC_MESSAGE_ACK,
                    PayloadType.DIAGNOSTIC_MESSAGE_NACK,
                ):
                    source, _target, rest = parse_diagnostic_message(message.payload)
                    code = rest[0] if rest else 0
                    self._acks.put_nowait((message.payload_type, source, code))
                elif message.payload_type == PayloadType.ALIVE_CHECK_REQUEST:
                    await self._write(
                        PayloadType.ALIVE_CHECK_RESPONSE, struct.pack(">H", self.tester_address)
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._failure = exc

    def _raise_if_failed(self) -> None:
        if self._failure is not None:
            raise DiagnosticConnectionError(f"DoIP connection failed: {self._failure}") from self._failure

    async def send_diagnostic(self, target: int, data: bytes, ack_timeout: float = 2.0) -> None:
        self._raise_if_failed()
        async with self._send_lock:  # ACKs carry no request id: one outstanding message at a time
            await self._write(
                PayloadType.DIAGNOSTIC_MESSAGE, diagnostic_message(self.tester_address, target, data)
            )
            try:
                async with asyncio.timeout(ack_timeout):
                    payload_type, source, code = await self._acks.get()
            except TimeoutError as exc:
                self._raise_if_failed()
                raise DiagnosticTimeoutError(f"No DoIP diagnostic ACK from 0x{target:04X}") from exc
        if payload_type == PayloadType.DIAGNOSTIC_MESSAGE_NACK:
            reason = DIAGNOSTIC_NACK_REASONS.get(code, f"code 0x{code:02X}")
            raise DiagnosticConnectionError(
                f"DoIP entity rejected message to 0x{target:04X}: {reason}",
                details={"nack_code": code, "source": source},
            )

    async def recv_diagnostic(self, source: int, timeout: float) -> bytes:
        self._raise_if_failed()
        queue = self._inbox.setdefault(source, asyncio.Queue())
        try:
            async with asyncio.timeout(timeout):
                return await queue.get()
        except TimeoutError as exc:
            self._raise_if_failed()
            raise DiagnosticTimeoutError(f"No DoIP diagnostic message from 0x{source:04X}") from exc
