"""VIN validation and the manufacturer-independent part of VIN decoding (ISO 3779 / ISO 3780).

Only what the standards define is decoded with certainty: format, check digit (mandatory in North
America, optional elsewhere — so an invalid check digit is a *warning*, not a rejection), the WMI and
the model-year code. The VDS (positions 4-8) is manufacturer-specific; its meaning is returned as
UNKNOWN unless a verified decoder is supplied.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

_VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
_TRANSLITERATION = {
    **{str(d): d for d in range(10)},
    **dict(zip("ABCDEFGH", range(1, 9), strict=True)),
    **dict(zip("JKLMN", range(1, 6), strict=True)),
    "P": 7,
    "R": 9,
    **dict(zip("STUVWXYZ", range(2, 10), strict=True)),
}
_WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)
_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789"  # 30-year cycle starting 1980 / 2010

# World Manufacturer Identifiers relevant to this platform (SAE-assigned, publicly registered).
KNOWN_WMI: dict[str, str] = {
    "SAL": "Land Rover",
    "SAJ": "Jaguar",
}


def normalize_vin(vin: str) -> str:
    return vin.strip().upper()


def is_valid_format(vin: str) -> bool:
    return bool(_VIN_RE.match(vin))


def compute_check_digit(vin: str) -> str:
    total = sum(_TRANSLITERATION[ch] * w for ch, w in zip(vin, _WEIGHTS, strict=True))
    remainder = total % 11
    return "X" if remainder == 10 else str(remainder)


def check_digit_valid(vin: str) -> bool:
    return is_valid_format(vin) and vin[8] == compute_check_digit(vin)


def with_check_digit(vin: str) -> str:
    """Return ``vin`` with position 9 replaced by the computed check digit (used by the simulator)."""

    vin = normalize_vin(vin)
    if not is_valid_format(vin):
        raise ValueError(f"Invalid VIN format: {vin!r}")
    return vin[:8] + compute_check_digit(vin) + vin[9:]


def model_year_candidates(code: str) -> list[int]:
    index = _YEAR_CODES.find(code)
    if index < 0:
        return []
    return [1980 + index, 2010 + index]


@dataclass(frozen=True, slots=True)
class DecodedVin:
    vin: str
    valid_format: bool
    check_digit_valid: bool | None
    wmi: str | None
    manufacturer: str | None
    vds: str | None
    vis: str | None
    model_year: int | None
    model_year_candidates: list[int] = field(default_factory=list)
    serial: str | None = None
    warnings: list[str] = field(default_factory=list)


def decode_vin(vin: str, *, today: date | None = None) -> DecodedVin:
    vin = normalize_vin(vin)
    warnings: list[str] = []
    if not is_valid_format(vin):
        return DecodedVin(
            vin=vin,
            valid_format=False,
            check_digit_valid=None,
            wmi=None,
            manufacturer=None,
            vds=None,
            vis=None,
            model_year=None,
            warnings=["VIN must be 17 characters from [A-Z0-9] excluding I, O and Q"],
        )
    check_ok = check_digit_valid(vin)
    if not check_ok:
        warnings.append(
            "Check digit (position 9) does not match. It is mandatory in North America only, "
            "so this alone does not prove the VIN is wrong."
        )
    wmi = vin[:3]
    manufacturer = KNOWN_WMI.get(wmi)
    if manufacturer is None:
        warnings.append(f"WMI {wmi} is not a Jaguar Land Rover identifier known to this platform")
    candidates = model_year_candidates(vin[9])
    current_year = (today or date.today()).year
    plausible = [y for y in candidates if y <= current_year + 1]
    model_year = max(plausible) if plausible else None
    if not candidates:
        warnings.append(f"Model year code {vin[9]!r} is not a valid ISO 3779 year code")
    return DecodedVin(
        vin=vin,
        valid_format=True,
        check_digit_valid=check_ok,
        wmi=wmi,
        manufacturer=manufacturer,
        vds=vin[3:8],
        vis=vin[9:],
        model_year=model_year,
        model_year_candidates=candidates,
        serial=vin[11:],
        warnings=warnings,
    )
