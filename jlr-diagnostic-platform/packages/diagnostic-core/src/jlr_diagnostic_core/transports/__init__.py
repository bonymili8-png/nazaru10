"""DiagnosticInterface implementations."""

from jlr_diagnostic_core.transports.can import CanAddressPlan, CANInterface
from jlr_diagnostic_core.transports.doip import DoIPInterface
from jlr_diagnostic_core.transports.j2534 import J2534Interface
from jlr_diagnostic_core.transports.socketcan import SocketCanBus, SocketCANInterface

__all__ = [
    "CANInterface",
    "CanAddressPlan",
    "DoIPInterface",
    "J2534Interface",
    "SocketCANInterface",
    "SocketCanBus",
]
