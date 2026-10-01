"""Hardware abstraction: the :class:`DiagnosticInterface` protocol and diagnostic addressing.

Application code talks to ECUs through a DiagnosticInterface and never sees CAN frames, ISO-TP PCI
bytes or DoIP headers. Implementations:

* :class:`jlr_diagnostic_core.transports.can.CANInterface` — UDS/OBD over ISO-TP over any CanBus
  (``MockInterface`` = CANInterface + simulator bus, ``SocketCANInterface`` = + Linux SocketCAN)
* :class:`jlr_diagnostic_core.transports.doip.DoIPInterface` — UDS over DoIP (TCP)
* :class:`jlr_diagnostic_core.transports.j2534.J2534Interface` — explicit limitation (not available)
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol, runtime_checkable

from jlr_shared_types.models import InterfaceKind, InterfaceStatus


class TransportProtocol(StrEnum):
    ISOTP_CAN = "ISO-TP/CAN"
    ISOTP_CAN_FD = "ISO-TP/CAN-FD"
    DOIP = "DoIP"


@dataclass(frozen=True, slots=True)
class DiagnosticAddress:
    """Physical addressing of one ECU: request and response identifiers.

    For CAN these are arbitration IDs; for DoIP both are the ECU's logical address.
    """

    request: int
    response: int
    transport: TransportProtocol = TransportProtocol.ISOTP_CAN
    extended_id: bool = False

    @property
    def id(self) -> str:
        width = 8 if self.extended_id else (4 if self.transport is TransportProtocol.DOIP else 3)
        return f"0x{self.request:0{width}X}"

    @property
    def protocol_label(self) -> str:
        if self.transport is TransportProtocol.DOIP:
            return "UDS/DoIP"
        bits = "29bit" if self.extended_id else "11bit"
        return f"UDS/{self.transport.value}-{bits}"


@runtime_checkable
class DiagnosticInterface(Protocol):
    kind: InterfaceKind

    async def connect(self) -> None: ...

    async def disconnect(self) -> None: ...

    async def send(self, address: DiagnosticAddress, payload: bytes) -> None:
        """Send one diagnostic request PDU (transport segmentation is the interface's job)."""
        ...

    async def read(self, address: DiagnosticAddress, timeout: float) -> bytes:
        """Receive one complete diagnostic response PDU from ``address``."""
        ...

    async def status(self) -> InterfaceStatus: ...

    async def functional_request(
        self, payload: bytes, timeout: float
    ) -> list[tuple[DiagnosticAddress, bytes]]:
        """Broadcast a single-frame functional request (e.g. OBD) and collect every response."""
        ...

    def candidate_addresses(self) -> Sequence[DiagnosticAddress]:
        """Addresses discovery may probe. Never assumed to be the vehicle's actual ECU list."""
        ...

    async def passive_listen(self, duration: float) -> set[int]:
        """Identifiers observed on the bus without transmitting (to avoid probing on used IDs)."""
        ...


class EcuTransport:
    """Binds an interface to one ECU address so a UdsClient can use it."""

    def __init__(self, interface: DiagnosticInterface, address: DiagnosticAddress) -> None:
        self.interface = interface
        self.address = address

    @property
    def label(self) -> str:
        return self.address.id

    async def send(self, payload: bytes) -> None:
        await self.interface.send(self.address, payload)

    async def recv(self, timeout: float) -> bytes:
        return await self.interface.read(self.address, timeout)
