from __future__ import annotations

import asyncio

import pytest

from jlr_protocols.isotp import (
    FlowStatus,
    FrameType,
    IsoTpChannel,
    IsoTpConfig,
    Reassembler,
    decode_st_min,
    encode_flow_control,
    encode_st_min,
    parse_frame,
    segment,
)
from jlr_shared_types.errors import DiagnosticTimeoutError, ProtocolError


class QueueSource:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[bytes] = asyncio.Queue()

    async def get(self, timeout: float) -> bytes:
        try:
            async with asyncio.timeout(timeout):
                return await self.queue.get()
        except TimeoutError as exc:
            raise DiagnosticTimeoutError("timeout") from exc


def link(
    config_a: IsoTpConfig, config_b: IsoTpConfig | None = None
) -> tuple[IsoTpChannel, IsoTpChannel, list[bytes]]:
    """Two channels wired back to back; returns (a, b, wire log of a->b frames)."""

    a_in, b_in = QueueSource(), QueueSource()
    wire: list[bytes] = []

    async def a_send(data: bytes) -> None:
        wire.append(data)
        b_in.queue.put_nowait(data)

    async def b_send(data: bytes) -> None:
        a_in.queue.put_nowait(data)

    return IsoTpChannel(a_send, a_in, config_a), IsoTpChannel(b_send, b_in, config_b or config_a), wire


def test_single_frame_classic_padded() -> None:
    frames = segment(b"\x22\xf1\x90", IsoTpConfig())
    assert frames == [bytes.fromhex("0322F190CCCCCCCC")]
    parsed = parse_frame(frames[0])
    assert parsed.type is FrameType.SINGLE
    assert parsed.data == b"\x22\xf1\x90"


def test_single_frame_unpadded() -> None:
    assert segment(b"\x3e\x00", IsoTpConfig(padding=None)) == [b"\x02\x3e\x00"]


def test_multi_frame_classic() -> None:
    payload = bytes(range(20))
    frames = segment(payload, IsoTpConfig())
    assert frames[0][:2] == bytes([0x10, 20])
    assert [f[0] for f in frames[1:]] == [0x21, 0x22]
    first = parse_frame(frames[0])
    reassembler = Reassembler(first, 4095)
    for frame in frames[1:]:
        reassembler.feed(parse_frame(frame))
    assert reassembler.complete
    assert reassembler.message() == payload


def test_sequence_number_wraps() -> None:
    frames = segment(bytes(200), IsoTpConfig())
    sequences = [f[0] & 0x0F for f in frames[1:]]
    assert sequences[:17] == [*range(1, 16), 0, 1]


def test_wrong_sequence_number_rejected() -> None:
    frames = segment(bytes(30), IsoTpConfig())
    reassembler = Reassembler(parse_frame(frames[0]), 4095)
    with pytest.raises(ProtocolError, match="sequence"):
        reassembler.feed(parse_frame(frames[2]))


def test_can_fd_single_frame_with_escape_length() -> None:
    config = IsoTpConfig(tx_dl=64)
    payload = bytes(range(40))
    frames = segment(payload, config)
    assert len(frames) == 1
    assert frames[0][:2] == bytes([0x00, 40])
    assert len(frames[0]) == 48  # next valid CAN-FD length
    assert parse_frame(frames[0]).data == payload


def test_can_fd_multi_frame() -> None:
    config = IsoTpConfig(tx_dl=64)
    payload = bytes(i & 0xFF for i in range(300))
    frames = segment(payload, config)
    assert len(frames[0]) == 64
    reassembler = Reassembler(parse_frame(frames[0]), 4095)
    for frame in frames[1:]:
        reassembler.feed(parse_frame(frame))
    assert reassembler.message() == payload


def test_32bit_first_frame_length() -> None:
    config = IsoTpConfig(max_message_size=10_000)
    payload = bytes(5000)
    frames = segment(payload, config)
    assert frames[0][:2] == b"\x10\x00"
    assert int.from_bytes(frames[0][2:6], "big") == 5000
    assert parse_frame(frames[0]).length == 5000


def test_message_too_large_rejected() -> None:
    with pytest.raises(ProtocolError):
        segment(bytes(5000), IsoTpConfig())
    with pytest.raises(ProtocolError):
        segment(b"", IsoTpConfig())


@pytest.mark.parametrize(
    ("seconds", "byte"), [(0, 0x00), (0.001, 0x01), (0.127, 0x7F), (0.0001, 0xF1), (0.0009, 0xF9)]
)
def test_st_min_round_trip(seconds: float, byte: int) -> None:
    assert encode_st_min(seconds) == byte
    assert decode_st_min(byte) == pytest.approx(seconds)


def test_reserved_st_min_is_max() -> None:
    assert decode_st_min(0x80) == 0.127
    assert decode_st_min(0xFA) == 0.127


def test_flow_control_codec() -> None:
    frame = parse_frame(encode_flow_control(FlowStatus.WAIT, 8, 0.005, IsoTpConfig()))
    assert frame.type is FrameType.FLOW_CONTROL
    assert frame.flow_status is FlowStatus.WAIT
    assert frame.block_size == 8
    assert frame.st_min == pytest.approx(0.005)


@pytest.mark.parametrize(
    "raw", [b"", b"\x00", b"\x08" + bytes(7), b"\x10\x05" + bytes(6), b"\x33\x00\x00", b"\x40"]
)
def test_invalid_frames_rejected(raw: bytes) -> None:
    with pytest.raises(ProtocolError):
        parse_frame(raw)


async def test_channel_round_trip_with_block_size_and_st_min() -> None:
    sender_cfg = IsoTpConfig()
    receiver_cfg = IsoTpConfig(block_size=2, st_min=0.001)
    a, b, wire = link(sender_cfg, receiver_cfg)
    payload = bytes(range(100))
    receive = asyncio.create_task(b.recv(1.0))
    await a.send(payload)
    assert await receive == payload
    assert len(wire) == 1 + 14  # FF (6 bytes) + 14 CFs (7 bytes each)


async def test_flow_control_wait_then_continue() -> None:
    a_in = QueueSource()
    sent: list[bytes] = []

    async def send(data: bytes) -> None:
        sent.append(data)
        if data[0] >> 4 == FrameType.FIRST:
            a_in.queue.put_nowait(encode_flow_control(FlowStatus.WAIT, 0, 0, IsoTpConfig()))
            a_in.queue.put_nowait(encode_flow_control(FlowStatus.CONTINUE_TO_SEND, 0, 0, IsoTpConfig()))

    channel = IsoTpChannel(send, a_in, IsoTpConfig())
    await channel.send(bytes(20))
    assert len(sent) == 3


async def test_flow_control_overflow_raises() -> None:
    source = QueueSource()

    async def send(data: bytes) -> None:
        source.queue.put_nowait(encode_flow_control(FlowStatus.OVERFLOW, 0, 0, IsoTpConfig()))

    with pytest.raises(ProtocolError, match="overflow"):
        await IsoTpChannel(send, source, IsoTpConfig()).send(bytes(20))


async def test_missing_flow_control_times_out() -> None:
    async def send(data: bytes) -> None:
        return None

    channel = IsoTpChannel(send, QueueSource(), IsoTpConfig(timeout_n_bs=0.02))
    with pytest.raises(DiagnosticTimeoutError, match="N_Bs"):
        await channel.send(bytes(20))


async def test_interrupted_transfer_times_out() -> None:
    source = QueueSource()
    sent: list[bytes] = []

    async def send(data: bytes) -> None:
        sent.append(data)

    channel = IsoTpChannel(send, source, IsoTpConfig(timeout_n_cr=0.02))
    source.queue.put_nowait(segment(bytes(20), IsoTpConfig())[0])  # first frame only
    with pytest.raises(DiagnosticTimeoutError, match="N_Cr"):
        await channel.recv(0.1)
    assert parse_frame(sent[0]).type is FrameType.FLOW_CONTROL


async def test_oversized_incoming_message_answers_overflow() -> None:
    source = QueueSource()
    sent: list[bytes] = []

    async def send(data: bytes) -> None:
        sent.append(data)

    channel = IsoTpChannel(send, source, IsoTpConfig(max_message_size=16))
    source.queue.put_nowait(segment(bytes(100), IsoTpConfig())[0])
    with pytest.raises(ProtocolError):
        await channel.recv(0.1)
    assert parse_frame(sent[0]).flow_status is FlowStatus.OVERFLOW
