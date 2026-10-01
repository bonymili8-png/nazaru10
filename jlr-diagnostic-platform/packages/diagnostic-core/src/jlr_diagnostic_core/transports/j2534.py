"""SAE J2534 PassThru — EXPLICIT LIMITATION (not available in Milestone 1).

J2534 adapters are driven through a vendor-supplied native library (``PassThruOpen``,
``PassThruConnect``, ``PassThruReadMsgs``...), normally a Windows DLL. Supporting it needs a
ctypes binding validated against a real device, which this repository does not have. The class
exists so configuration, capability reporting and the API behave consistently: connecting raises
UnsupportedOperationError instead of pretending to work. Roadmap: Milestone 3 (docs/ROADMAP.md).
"""

from __future__ import annotations

from collections.abc import Sequence

from jlr_diagnostic_core.interface import DiagnosticAddress
from jlr_shared_types.errors import UnsupportedOperationError
from jlr_shared_types.models import InterfaceKind, InterfaceStatus

_REASON = (
    "J2534 PassThru is not implemented yet: it requires a vendor PassThru library and validation on "
    "real hardware (planned for Milestone 3). Use the mock, socketcan or doip interface."
)


class J2534Interface:
    kind = InterfaceKind.J2534

    def __init__(self, library_path: str | None = None) -> None:
        self.library_path = library_path

    async def connect(self) -> None:
        raise UnsupportedOperationError(_REASON, details={"library_path": self.library_path})

    async def disconnect(self) -> None:
        return None

    async def send(self, address: DiagnosticAddress, payload: bytes) -> None:
        raise UnsupportedOperationError(_REASON)

    async def read(self, address: DiagnosticAddress, timeout: float) -> bytes:
        raise UnsupportedOperationError(_REASON)

    async def functional_request(
        self, payload: bytes, timeout: float
    ) -> list[tuple[DiagnosticAddress, bytes]]:
        raise UnsupportedOperationError(_REASON)

    def candidate_addresses(self) -> Sequence[DiagnosticAddress]:
        return []

    async def passive_listen(self, duration: float) -> set[int]:
        return set()

    async def status(self) -> InterfaceStatus:
        return InterfaceStatus(kind=self.kind, connected=False, description=_REASON)
