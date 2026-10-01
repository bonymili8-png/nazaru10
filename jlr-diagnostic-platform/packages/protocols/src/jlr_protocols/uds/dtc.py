"""DTC number formatting (ISO 15031-6 / SAE J2012 display format) and status decoding."""

from __future__ import annotations

from dataclasses import dataclass

from jlr_protocols.uds import constants as c

_SYSTEM_LETTERS = "PCBU"

# SAE J2012 failure type byte categories (high nibble) — standard, manufacturer-independent.
_FTB_CATEGORIES: dict[int, str] = {
    0x0: "General failure information",
    0x1: "General electrical failure",
    0x2: "General signal failure",
    0x3: "FM (frequency modulated) / PWM failure",
    0x4: "System internal failure",
    0x5: "System programming failure",
    0x6: "Algorithm based failure",
    0x7: "Mechanical failure",
    0x8: "Bus signal / message failure",
    0x9: "Component failure",
}

# A handful of fully specified SAE J2012 failure types.
_FTB_SPECIFIC: dict[int, str] = {
    0x00: "No sub type information",
    0x01: "General electrical failure",
    0x11: "Circuit short to ground",
    0x12: "Circuit short to battery",
    0x13: "Circuit open",
    0x14: "Circuit short to ground or open",
    0x15: "Circuit short to battery or open",
    0x16: "Circuit voltage below threshold",
    0x17: "Circuit voltage above threshold",
    0x1C: "Circuit voltage out of range",
    0x29: "Signal invalid",
    0x62: "Signal compare failure",
    0x64: "Signal plausibility failure",
    0x87: "Missing message",
    0x88: "Bus off",
    0x96: "Component internal failure",
}


def dtc_code(dtc: int, *, two_byte: bool = False) -> str:
    """Five-character code ("P0300") from a 24-bit UDS DTC or a 16-bit OBD DTC."""

    high = dtc if two_byte else dtc >> 8
    letter = _SYSTEM_LETTERS[(high >> 14) & 0x3]
    return f"{letter}{(high >> 12) & 0x3}{high & 0xFFF:03X}"


def dtc_display(dtc: int) -> str:
    """ "P0300-1C" style display of a 24-bit DTC (code + failure type byte)."""

    return f"{dtc_code(dtc)}-{dtc & 0xFF:02X}"


def parse_dtc_code(code: str) -> int:
    """Inverse of :func:`dtc_code` for the 16-bit part ("P0300" -> 0x0300)."""

    code = code.strip().upper()
    if len(code) != 5 or code[0] not in _SYSTEM_LETTERS or code[1] not in "0123":
        raise ValueError(f"Invalid DTC code {code!r}")
    return (_SYSTEM_LETTERS.index(code[0]) << 14) | (int(code[1]) << 12) | int(code[2:], 16)


def failure_type_description(failure_type: int) -> str | None:
    if failure_type in _FTB_SPECIFIC:
        return _FTB_SPECIFIC[failure_type]
    category = _FTB_CATEGORIES.get(failure_type >> 4)
    return f"{category} (sub type 0x{failure_type & 0x0F:X})" if category else None


@dataclass(frozen=True, slots=True)
class DtcStatus:
    byte: int

    @property
    def test_failed(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_TEST_FAILED)

    @property
    def test_failed_this_operation_cycle(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_TEST_FAILED_THIS_OPERATION_CYCLE)

    @property
    def pending(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_PENDING)

    @property
    def confirmed(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_CONFIRMED)

    @property
    def test_not_completed_since_last_clear(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_TEST_NOT_COMPLETED_SINCE_LAST_CLEAR)

    @property
    def test_failed_since_last_clear(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_TEST_FAILED_SINCE_LAST_CLEAR)

    @property
    def test_not_completed_this_operation_cycle(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_TEST_NOT_COMPLETED_THIS_OPERATION_CYCLE)

    @property
    def warning_indicator_requested(self) -> bool:
        return bool(self.byte & c.DTC_STATUS_WARNING_INDICATOR_REQUESTED)

    def as_dict(self) -> dict[str, bool]:
        return {
            "test_failed": self.test_failed,
            "test_failed_this_operation_cycle": self.test_failed_this_operation_cycle,
            "pending": self.pending,
            "confirmed": self.confirmed,
            "test_not_completed_since_last_clear": self.test_not_completed_since_last_clear,
            "test_failed_since_last_clear": self.test_failed_since_last_clear,
            "test_not_completed_this_operation_cycle": self.test_not_completed_this_operation_cycle,
            "warning_indicator_requested": self.warning_indicator_requested,
        }
