from __future__ import annotations

import pytest

from jlr_diagnostic_core.transports.socketcan import CAN_EFF_FLAG, pack_frame, unpack_frame
from jlr_protocols import obd
from jlr_protocols.can import CanFrame, fd_frame_length
from jlr_protocols.doip import (
    DoIPMessage,
    PayloadType,
    decode_message,
    parse_routing_activation_response,
    parse_vehicle_announcement,
    routing_activation_request,
)
from jlr_shared_types.errors import NegativeResponseError, ProtocolError
from jlr_simulator.ecu import OBD_ENCODING, encode_linear

# ------------------------------------------------------------------ OBD-II


def test_supported_pid_bitmap() -> None:
    assert obd.parse_supported_pids(0x00, bytes.fromhex("BE1FA813")) == {
        0x01,
        0x03,
        0x04,
        0x05,
        0x06,
        0x07,
        0x0C,
        0x0D,
        0x0E,
        0x0F,
        0x10,
        0x11,
        0x13,
        0x15,
        0x1C,
        0x1F,
        0x20,
    }


def test_multi_pid_response() -> None:
    response = bytes.fromhex("41" + "0C1AF8" + "0D3C" + "057B")
    data = obd.parse_mode01_response(response, [0x0C, 0x0D, 0x05])
    assert obd.PIDS[0x0C].decode(data[0x0C]) == 1726.0
    assert obd.PIDS[0x0D].decode(data[0x0D]) == 60.0
    assert obd.PIDS[0x05].decode(data[0x05]) == 83.0


def test_mode01_errors() -> None:
    with pytest.raises(ProtocolError):
        obd.parse_mode01_response(bytes.fromhex("410C1A"), [0x0C])
    with pytest.raises(ProtocolError):
        obd.parse_mode01_response(bytes.fromhex("410D3C"), [0x0C])
    with pytest.raises(NegativeResponseError):
        obd.parse_mode01_response(bytes.fromhex("7F0112"), [0x0C])
    with pytest.raises(ProtocolError):
        obd.build_request(obd.ObdMode.CURRENT_DATA, *range(7))


def test_vin_and_dtc_list() -> None:
    vin = "SALKA9AE6RA900101"
    assert obd.parse_vin(b"\x49\x02\x01" + vin.encode()) == vin
    with pytest.raises(ProtocolError):
        obd.parse_vin(b"\x49\x02\x01SHORT")
    assert obd.parse_dtc_list(obd.ObdMode.STORED_DTCS, bytes.fromhex("4302" + "0171" + "0420")) == [
        0x0171,
        0x0420,
    ]
    assert (
        obd.parse_ecu_name(b"\x49\x0a\x01" + b"ECM-EngineControl".ljust(20, b"\x00")) == "ECM-EngineControl"
    )


@pytest.mark.parametrize("pid", sorted(OBD_ENCODING))
def test_simulator_encoding_matches_sae_decoding(pid: int) -> None:
    length, scale, offset = OBD_ENCODING[pid]
    spec = obd.PIDS[pid]
    assert spec.length == length
    sample = (spec.min_value or 0) + ((spec.max_value or 100) - (spec.min_value or 0)) * 0.37
    assert spec.decode(encode_linear(sample, length, scale, offset)) == pytest.approx(sample, abs=scale)


# ------------------------------------------------------------------ CAN


def test_can_frame_validation() -> None:
    with pytest.raises(ProtocolError):
        CanFrame(0x800, b"")
    with pytest.raises(ProtocolError):
        CanFrame(0x7E0, bytes(9))
    with pytest.raises(ProtocolError):
        CanFrame(0x7E0, bytes(9), is_fd=True)
    CanFrame(0x18DA10F1, bytes(8), is_extended_id=True)
    assert fd_frame_length(9) == 12
    assert fd_frame_length(33) == 48
    assert str(CanFrame(0x7E0, b"\x02\x3e\x00")) == "7E0#023E00"


def test_socketcan_pack_round_trip() -> None:
    for frame in (
        CanFrame(0x7E0, b"\x02\x3e\x00"),
        CanFrame(0x18DA10F1, bytes(8), is_extended_id=True),
        CanFrame(0x7E0, bytes(range(12)), is_fd=True, bitrate_switch=True),
    ):
        raw = pack_frame(frame)
        assert unpack_frame(raw) == frame
    extended = pack_frame(CanFrame(0x18DA10F1, b"", is_extended_id=True))
    assert int.from_bytes(extended[:4], "little") & CAN_EFF_FLAG
    assert unpack_frame(b"\x00" * 3) is None


# ------------------------------------------------------------------ DoIP codec


def test_doip_header_round_trip() -> None:
    message = DoIPMessage(PayloadType.ROUTING_ACTIVATION_REQUEST, routing_activation_request(0x0E00))
    encoded = message.encode()
    assert encoded[:2] == b"\x02\xfd"
    assert decode_message(encoded) == message


def test_doip_header_inverse_mismatch() -> None:
    encoded = bytearray(DoIPMessage(PayloadType.ALIVE_CHECK_REQUEST, b"").encode())
    encoded[1] = 0x00
    with pytest.raises(ProtocolError):
        decode_message(bytes(encoded))


def test_doip_payload_parsers() -> None:
    response = parse_routing_activation_response(bytes.fromhex("0E00100110") + b"\x00" * 4)
    assert (response.tester_address, response.entity_address, response.code) == (0x0E00, 0x1001, 0x10)
    announcement = parse_vehicle_announcement(
        b"SALKA9AE6RA900101" + bytes.fromhex("1001") + bytes(12) + b"\x00"
    )
    assert announcement.vin == "SALKA9AE6RA900101"
    assert announcement.logical_address == 0x1001
