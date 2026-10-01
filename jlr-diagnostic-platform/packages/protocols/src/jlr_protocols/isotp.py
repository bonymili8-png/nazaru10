"""ISO 15765-2 (ISO-TP) transport: segmentation, reassembly and flow control.

Supports classic CAN (8-byte frames) and CAN-FD (TX_DL up to 64), 12-bit and 32-bit (escape)
first-frame lengths, flow-control WAIT/OVERFLOW, block size and STmin in both directions.

The codec functions are pure; :class:`IsoTpChannel` adds the timed, asynchronous state machine and is
used both by the tester (diagnostic interface) and by simulated ECUs.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import IntEnum
from typing import Protocol

from jlr_protocols.can import fd_frame_length
from jlr_shared_types.errors import DiagnosticTimeoutError, ProtocolError

MAX_12BIT_LENGTH = 0xFFF
MAX_32BIT_LENGTH = 0xFFFFFFFF


class FrameType(IntEnum):
    SINGLE = 0
    FIRST = 1
    CONSECUTIVE = 2
    FLOW_CONTROL = 3


class FlowStatus(IntEnum):
    CONTINUE_TO_SEND = 0
    WAIT = 1
    OVERFLOW = 2


@dataclass(frozen=True, slots=True)
class IsoTpConfig:
    tx_dl: int = 8  # 8 for classic CAN, 12..64 for CAN-FD
    padding: int | None = 0xCC  # None: no padding (minimal frame length, classic CAN only)
    block_size: int = 0  # BS we advertise as receiver (0 = no further flow control)
    st_min: float = 0.0  # STmin we advertise as receiver, seconds
    timeout_n_bs: float = 1.0  # sender waiting for flow control
    timeout_n_cr: float = 1.0  # receiver waiting for the next consecutive frame
    max_wait_frames: int = 10
    max_message_size: int = MAX_12BIT_LENGTH

    def __post_init__(self) -> None:
        if self.tx_dl != 8 and self.tx_dl not in (12, 16, 20, 24, 32, 48, 64):
            raise ProtocolError(f"Invalid ISO-TP TX_DL {self.tx_dl}")
        if not 0 <= self.block_size <= 0xFF:
            raise ProtocolError("Block size must fit one byte")

    @property
    def is_fd(self) -> bool:
        return self.tx_dl > 8


@dataclass(frozen=True, slots=True)
class IsoTpFrame:
    type: FrameType
    data: bytes = b""
    length: int = 0  # SF/FF: total message length
    sequence: int = 0  # CF
    flow_status: FlowStatus = FlowStatus.CONTINUE_TO_SEND  # FC
    block_size: int = 0  # FC
    st_min: float = 0.0  # FC, seconds


# --------------------------------------------------------------------------------------------------
# STmin
# --------------------------------------------------------------------------------------------------


def encode_st_min(seconds: float) -> int:
    if seconds <= 0:
        return 0
    if seconds < 0.001:
        return 0xF0 + max(1, min(9, round(seconds * 10_000)))
    return min(0x7F, round(seconds * 1000))


def decode_st_min(value: int) -> float:
    if value <= 0x7F:
        return value / 1000
    if 0xF1 <= value <= 0xF9:
        return (value - 0xF0) / 10_000
    # Reserved values shall be interpreted as the maximum (ISO 15765-2 9.6.5.5).
    return 0.127


# --------------------------------------------------------------------------------------------------
# Codec
# --------------------------------------------------------------------------------------------------


def _pad(frame: bytes, config: IsoTpConfig) -> bytes:
    if config.is_fd:
        target = fd_frame_length(len(frame)) if len(frame) > 8 else 8
        if config.padding is None and len(frame) <= 8:
            return frame
        return frame + bytes([config.padding if config.padding is not None else 0xCC]) * (target - len(frame))
    if config.padding is None:
        return frame
    return frame + bytes([config.padding]) * (8 - len(frame))


def segment(payload: bytes, config: IsoTpConfig) -> list[bytes]:
    """Split ``payload`` into a single frame, or a first frame followed by consecutive frames."""

    length = len(payload)
    if length == 0:
        raise ProtocolError("ISO-TP cannot send an empty message")
    if length > config.max_message_size:
        raise ProtocolError(f"Message of {length} bytes exceeds the configured maximum")

    # Single frame
    if length <= 7:
        return [_pad(bytes([length]) + payload, config)]
    if config.is_fd and length <= config.tx_dl - 2:
        return [_pad(bytes([0x00, length]) + payload, config)]

    frames: list[bytes] = []
    if length <= MAX_12BIT_LENGTH:
        header = bytes([0x10 | (length >> 8), length & 0xFF])
    else:
        header = bytes([0x10, 0x00]) + length.to_bytes(4, "big")
    first_chunk = config.tx_dl - len(header)
    frames.append(header + payload[:first_chunk])  # first frame always uses the full TX_DL
    offset = first_chunk
    sequence = 1
    chunk = config.tx_dl - 1
    while offset < length:
        frames.append(_pad(bytes([0x20 | (sequence & 0x0F)]) + payload[offset : offset + chunk], config))
        offset += chunk
        sequence = (sequence + 1) & 0x0F
    return frames


def encode_flow_control(status: FlowStatus, block_size: int, st_min: float, config: IsoTpConfig) -> bytes:
    return _pad(bytes([0x30 | int(status), block_size & 0xFF, encode_st_min(st_min)]), config)


def parse_frame(data: bytes) -> IsoTpFrame:
    if not data:
        raise ProtocolError("Empty CAN frame cannot carry ISO-TP data")
    pci = data[0] >> 4
    if pci == FrameType.SINGLE:
        length = data[0] & 0x0F
        if length == 0:
            if len(data) <= 8 or len(data) < 2:
                raise ProtocolError("Single frame with zero length")
            length = data[1]
            body = data[2 : 2 + length]
        else:
            body = data[1 : 1 + length]
        if len(body) != length or length == 0:
            raise ProtocolError(f"Single frame announces {length} bytes but carries {len(body)}")
        return IsoTpFrame(FrameType.SINGLE, data=body, length=length)
    if pci == FrameType.FIRST:
        if len(data) < 8:
            raise ProtocolError("First frame shorter than 8 bytes")
        length = ((data[0] & 0x0F) << 8) | data[1]
        if length == 0:
            length = int.from_bytes(data[2:6], "big")
            body = data[6:]
        else:
            body = data[2:]
        if length <= 7:
            raise ProtocolError(f"First frame announces only {length} bytes")
        return IsoTpFrame(FrameType.FIRST, data=body, length=length)
    if pci == FrameType.CONSECUTIVE:
        return IsoTpFrame(FrameType.CONSECUTIVE, data=data[1:], sequence=data[0] & 0x0F)
    if pci == FrameType.FLOW_CONTROL:
        if len(data) < 3:
            raise ProtocolError("Flow control frame shorter than 3 bytes")
        status_value = data[0] & 0x0F
        if status_value > FlowStatus.OVERFLOW:
            raise ProtocolError(f"Invalid flow status {status_value}")
        return IsoTpFrame(
            FrameType.FLOW_CONTROL,
            flow_status=FlowStatus(status_value),
            block_size=data[1],
            st_min=decode_st_min(data[2]),
        )
    raise ProtocolError(f"Unknown ISO-TP PCI type 0x{pci:X}")


class Reassembler:
    """Collects a segmented message. Feed it the first frame, then consecutive frames."""

    def __init__(self, first: IsoTpFrame, max_size: int) -> None:
        if first.type is not FrameType.FIRST:
            raise ProtocolError("Reassembly must start with a first frame")
        if first.length > max_size:
            raise ProtocolError(f"Incoming message of {first.length} bytes exceeds the maximum {max_size}")
        self.length = first.length
        self.buffer = bytearray(first.data[: first.length])
        self.expected_sequence = 1

    @property
    def complete(self) -> bool:
        return len(self.buffer) >= self.length

    def feed(self, frame: IsoTpFrame) -> None:
        if frame.type is not FrameType.CONSECUTIVE:
            raise ProtocolError(f"Expected consecutive frame, got {frame.type.name}")
        if frame.sequence != self.expected_sequence:
            raise ProtocolError(
                f"Wrong consecutive frame sequence number {frame.sequence}, expected {self.expected_sequence}"
            )
        remaining = self.length - len(self.buffer)
        self.buffer.extend(frame.data[:remaining])
        self.expected_sequence = (self.expected_sequence + 1) & 0x0F

    def message(self) -> bytes:
        return bytes(self.buffer[: self.length])


# --------------------------------------------------------------------------------------------------
# Async channel
# --------------------------------------------------------------------------------------------------


class FrameSource(Protocol):
    async def get(self, timeout: float) -> bytes:
        """Next raw CAN payload for this channel; raises DiagnosticTimeoutError on timeout."""
        ...


SendFrame = Callable[[bytes], Awaitable[None]]


class IsoTpChannel:
    """One ISO-TP conversation between a TX and an RX arbitration ID (normal addressing)."""

    def __init__(self, send_frame: SendFrame, frames: FrameSource, config: IsoTpConfig | None = None) -> None:
        self._send_frame = send_frame
        self._frames = frames
        self.config = config or IsoTpConfig()
        self._lock = asyncio.Lock()

    async def send(self, payload: bytes) -> None:
        async with self._lock:
            frames = segment(payload, self.config)
            await self._send_frame(frames[0])
            if len(frames) == 1:
                return
            index = 1
            while index < len(frames):
                block_size, st_min = await self._await_flow_control()
                sent_in_block = 0
                while index < len(frames) and (block_size == 0 or sent_in_block < block_size):
                    if st_min and sent_in_block:
                        await asyncio.sleep(st_min)
                    await self._send_frame(frames[index])
                    index += 1
                    sent_in_block += 1

    async def _await_flow_control(self) -> tuple[int, float]:
        waits = 0
        while True:
            try:
                raw = await self._frames.get(self.config.timeout_n_bs)
            except DiagnosticTimeoutError as exc:
                raise DiagnosticTimeoutError("ISO-TP N_Bs timeout waiting for flow control") from exc
            frame = parse_frame(raw)
            if frame.type is not FrameType.FLOW_CONTROL:
                # A stray frame (e.g. a late response) while waiting for FC is a protocol violation.
                raise ProtocolError(f"Expected flow control, received {frame.type.name} frame")
            if frame.flow_status is FlowStatus.CONTINUE_TO_SEND:
                return frame.block_size, frame.st_min
            if frame.flow_status is FlowStatus.OVERFLOW:
                raise ProtocolError("Receiver reported ISO-TP buffer overflow")
            waits += 1
            if waits > self.config.max_wait_frames:
                raise ProtocolError("Too many ISO-TP flow control WAIT frames")

    async def recv(self, timeout: float) -> bytes:
        """Receive one complete message. ``timeout`` bounds the wait for its first frame."""

        raw = await self._frames.get(timeout)
        frame = parse_frame(raw)
        if frame.type is FrameType.SINGLE:
            return frame.data
        if frame.type is not FrameType.FIRST:
            raise ProtocolError(f"Unexpected {frame.type.name} frame at start of message")
        try:
            reassembler = Reassembler(frame, self.config.max_message_size)
        except ProtocolError:
            await self._send_frame(encode_flow_control(FlowStatus.OVERFLOW, 0, 0, self.config))
            raise
        await self._send_frame(
            encode_flow_control(
                FlowStatus.CONTINUE_TO_SEND, self.config.block_size, self.config.st_min, self.config
            )
        )
        in_block = 0
        while not reassembler.complete:
            try:
                raw = await self._frames.get(self.config.timeout_n_cr)
            except DiagnosticTimeoutError as exc:
                raise DiagnosticTimeoutError("ISO-TP N_Cr timeout waiting for consecutive frame") from exc
            reassembler.feed(parse_frame(raw))
            in_block += 1
            if self.config.block_size and in_block == self.config.block_size and not reassembler.complete:
                in_block = 0
                await self._send_frame(
                    encode_flow_control(
                        FlowStatus.CONTINUE_TO_SEND, self.config.block_size, self.config.st_min, self.config
                    )
                )
        return reassembler.message()
