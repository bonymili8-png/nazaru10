from __future__ import annotations

import asyncio

import pytest

from jlr_protocols.uds import UdsClient, UdsTiming, codec, dtc_code, dtc_display, parse_dtc_code
from jlr_protocols.uds.constants import DiagnosticSessionType, DtcReportType, Nrc
from jlr_protocols.uds.dtc import DtcStatus, failure_type_description
from jlr_shared_types.errors import DiagnosticTimeoutError, NegativeResponseError, ProtocolError


class ScriptedTransport:
    """Answers each request with the next scripted list of responses."""

    def __init__(self, *scripts: list[bytes]) -> None:
        self.scripts = list(scripts)
        self.sent: list[bytes] = []
        self.inbox: asyncio.Queue[bytes] = asyncio.Queue()

    @property
    def label(self) -> str:
        return "0x7E0"

    async def send(self, payload: bytes) -> None:
        self.sent.append(payload)
        for response in self.scripts.pop(0) if self.scripts else []:
            self.inbox.put_nowait(response)

    async def recv(self, timeout: float) -> bytes:
        try:
            async with asyncio.timeout(timeout):
                return await self.inbox.get()
        except TimeoutError as exc:
            raise DiagnosticTimeoutError("timeout") from exc


def client(*scripts: list[bytes]) -> tuple[UdsClient, ScriptedTransport]:
    transport = ScriptedTransport(*scripts)
    return UdsClient(transport, UdsTiming(p2=0.02, p2_star=0.05, max_response_pending=3)), transport


# ------------------------------------------------------------------ codec


def test_builders() -> None:
    assert codec.build_diagnostic_session_control(DiagnosticSessionType.EXTENDED) == b"\x10\x03"
    assert codec.build_read_data_by_identifier(0xF190, 0xF18C) == bytes.fromhex("22F190F18C")
    assert codec.build_read_dtc_information(DtcReportType.DTC_BY_STATUS_MASK, 0xFF) == b"\x19\x02\xff"
    assert codec.build_read_dtc_information(0x04, 0xFF, dtc=0x030000) == bytes.fromhex("1904030000FF")
    assert codec.build_clear_diagnostic_information() == bytes.fromhex("14FFFFFF")
    assert codec.build_tester_present(suppress_response=True) == b"\x3e\x80"
    assert codec.build_routine_control(0x01, 0xFF00, b"\x01") == bytes.fromhex("3101FF0001")
    assert codec.build_read_memory_by_address(0x1000, 0x10) == bytes.fromhex("2324000010000010")
    assert codec.build_request_download(0x8000, 0x100) == bytes.fromhex("34004400008000" + "00000100")
    assert codec.build_transfer_data(1, b"\xaa") == b"\x36\x01\xaa"
    assert codec.build_security_access_request_seed(0x01) == b"\x27\x01"
    assert codec.build_security_access_send_key(0x01, b"\x12") == b"\x27\x02\x12"
    assert codec.build_write_data_by_identifier(0x1234, b"\x01") == bytes.fromhex("2E123401")


def test_builder_validation() -> None:
    with pytest.raises(ProtocolError):
        codec.build_security_access_request_seed(0x02)
    with pytest.raises(ProtocolError):
        codec.build_read_data_by_identifier()
    with pytest.raises(ProtocolError):
        codec.build_read_memory_by_address(0x1_0000_0000, 1)
    with pytest.raises(ProtocolError):
        codec.build_clear_diagnostic_information(0x1000000)


def test_check_response() -> None:
    assert codec.check_response(0x22, b"\x62\xf1\x90") == b"\x62\xf1\x90"
    with pytest.raises(NegativeResponseError) as info:
        codec.check_response(0x22, b"\x7f\x22\x31")
    assert info.value.nrc == Nrc.REQUEST_OUT_OF_RANGE
    assert info.value.nrc_name == "request_out_of_range"
    with pytest.raises(ProtocolError):
        codec.check_response(0x22, b"\x50\x01")
    with pytest.raises(ProtocolError):
        codec.check_response(0x22, b"")
    assert codec.is_response_pending(b"\x7f\x22\x78", 0x22)


def test_parsers() -> None:
    timing = codec.parse_diagnostic_session_control(bytes.fromhex("5003003201F4"))
    assert timing.p2_server_max == pytest.approx(0.05)
    assert timing.p2_star_server_max == pytest.approx(5.0)
    mask, records = codec.parse_dtc_by_status(bytes.fromhex("5902FF" + "030000AF" + "C1A20024"))
    assert mask == 0xFF
    assert [(r.dtc, r.status) for r in records] == [(0x030000, 0xAF), (0xC1A200, 0x24)]
    with pytest.raises(ProtocolError):
        codec.parse_dtc_by_status(bytes.fromhex("5902FF030000"))
    _, severities = codec.parse_dtc_by_severity(bytes.fromhex("5908FF" + "4000030000AF"))
    assert severities[0].severity == 0x40
    snapshot = codec.parse_dtc_snapshot(bytes.fromhex("5904030000AF" + "0101" + "01057D"))
    assert snapshot.records[0].record_number == 1
    assert snapshot.records[0].raw == bytes.fromhex("01057D")
    assert codec.parse_read_data_by_identifier(b"\x62\xf1\x90ABC", 0xF190) == b"ABC"
    with pytest.raises(ProtocolError):
        codec.parse_read_data_by_identifier(b"\x62\xf1\x91ABC", 0xF190)
    assert codec.parse_max_block_length(bytes.fromhex("74200FFF")) == 0x0FFF
    count = codec.parse_dtc_count(bytes.fromhex("5901FF010003"))
    assert count.count == 3


def test_dtc_formatting() -> None:
    assert dtc_code(0x030000) == "P0300"
    assert dtc_display(0x03001C) == "P0300-1C"
    assert dtc_code(0xC1A200) == "U01A2"
    assert dtc_code(0xDA2000) == "U1A20"
    assert dtc_code(0x4035, two_byte=True) == "C0035"
    assert dtc_code(0x9A55 << 8) == "B1A55"
    assert parse_dtc_code("P0420") == 0x0420
    assert parse_dtc_code("U0121") == 0xC121
    with pytest.raises(ValueError):
        parse_dtc_code("X0420")
    assert failure_type_description(0x13) == "Circuit open"
    assert failure_type_description(0x9A) is not None and "Component" in failure_type_description(0x9A)  # type: ignore[operator]
    status = DtcStatus(0xAF)
    assert status.test_failed and status.confirmed and status.warning_indicator_requested
    assert not status.test_not_completed_since_last_clear


# ------------------------------------------------------------------ client


async def test_client_positive_response() -> None:
    c, transport = client([b"\x62\xf1\x90" + b"SALKA9AE6RA900101"])
    assert await c.read_data_by_identifier(0xF190) == b"SALKA9AE6RA900101"
    assert transport.sent == [bytes.fromhex("22F190")]


async def test_client_handles_response_pending() -> None:
    c, _ = client([b"\x7f\x22\x78", b"\x7f\x22\x78", b"\x62\xf1\x90AB"])
    assert await c.read_data_by_identifier(0xF190) == b"AB"


async def test_client_pending_limit() -> None:
    c, _ = client([b"\x7f\x22\x78"] * 5)
    with pytest.raises(DiagnosticTimeoutError, match="responsePending"):
        await c.read_data_by_identifier(0xF190)


async def test_client_skips_stale_response() -> None:
    c, _ = client([b"\x7e\x00", b"\x62\xf1\x90AB"])
    assert await c.read_data_by_identifier(0xF190) == b"AB"


async def test_client_negative_response() -> None:
    c, _ = client([b"\x7f\x22\x33"])
    with pytest.raises(NegativeResponseError) as info:
        await c.read_data_by_identifier(0xF18C)
    assert info.value.nrc == Nrc.SECURITY_ACCESS_DENIED


async def test_client_timeout() -> None:
    c, _ = client([])
    with pytest.raises(DiagnosticTimeoutError):
        await c.tester_present()


async def test_suppressed_positive_response_returns_immediately() -> None:
    c, transport = client([])
    await c.tester_present(suppress_response=True)
    assert transport.sent == [b"\x3e\x80"]


async def test_trace_hook_records_both_directions() -> None:
    entries: list[dict[str, object]] = []
    transport = ScriptedTransport([b"\x7e\x00"])
    c = UdsClient(transport, UdsTiming(p2=0.05), trace=entries.append)
    await c.tester_present()
    assert [e["direction"] for e in entries] == ["TX", "RX"]
    assert entries[0]["hex"] == "3E 00"
