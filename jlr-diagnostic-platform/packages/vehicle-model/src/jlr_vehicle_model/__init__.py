"""Vehicle identity and version-aware vehicle profiles."""

from jlr_vehicle_model.vehicle import ProfileFact, VehicleProfile, build_profile
from jlr_vehicle_model.vin import (
    KNOWN_WMI,
    DecodedVin,
    check_digit_valid,
    compute_check_digit,
    decode_vin,
    is_valid_format,
    normalize_vin,
    with_check_digit,
)

__all__ = [
    "KNOWN_WMI",
    "DecodedVin",
    "ProfileFact",
    "VehicleProfile",
    "build_profile",
    "check_digit_valid",
    "compute_check_digit",
    "decode_vin",
    "is_valid_format",
    "normalize_vin",
    "with_check_digit",
]
