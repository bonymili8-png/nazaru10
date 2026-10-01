"""UDS over DoIP (ISO 13400-2) as a :class:`DiagnosticInterface`.

ISO 13400 has no standard way to enumerate the ECUs behind a DoIP entity, so the probe list is the
entity's own logical address plus operator-configured target addresses. Functional (broadcast)
requests are only available when a functional logical address is configured explicitly.
"""

from __future__ import annotations

from collections.abc import Sequence

from jlr_diagnostic_core.interface import DiagnosticAddress, TransportProtocol
from jlr_protocols.doip import DEFAULT_TESTER_ADDRESS, DOIP_PORT, DoIPClient
from jlr_shared_types.errors import (
    DiagnosticConnectionError,
    DiagnosticTimeoutError,
    NotConnectedError,
    UnsupportedOperationError,
)
from jlr_shared_types.models import InterfaceKind, InterfaceStatus


class DoIPInterface:
    kind = InterfaceKind.DOIP

    def __init__(
        self,
        host: str,
        port: int = DOIP_PORT,
        *,
        tester_address: int = DEFAULT_TESTER_ADDRESS,
        target_addresses: Sequence[int] = (),
        functional_address: int | None = None,
        simulation: bool = False,
    ) -> None:
        self.client = DoIPClient(host, port, tester_address=tester_address)
        self.target_addresses = list(target_addresses)
        self.functional_address = functional_address
        self.simulation = simulation
        self._sent = 0
        self._received = 0
        self._errors = 0
        self._timeouts = 0
        self._last_error: str | None = None

    async def connect(self) -> None:
        await self.client.connect()

    async def disconnect(self) -> None:
        await self.client.close()

    def _require(self) -> DoIPClient:
        if not self.client.connected:
            raise NotConnectedError("DoIP interface is not connected")
        return self.client

    async def send(self, address: DiagnosticAddress, payload: bytes) -> None:
        try:
            await self._require().send_diagnostic(address.request, payload)
            self._sent += 1
        except (DiagnosticConnectionError, DiagnosticTimeoutError) as exc:
            self._errors += 1
            self._last_error = str(exc)
            raise

    async def read(self, address: DiagnosticAddress, timeout: float) -> bytes:
        try:
            data = await self._require().recv_diagnostic(address.response, timeout)
        except DiagnosticTimeoutError as exc:
            self._timeouts += 1
            self._last_error = str(exc)
            raise
        self._received += 1
        return data

    async def functional_request(
        self, payload: bytes, timeout: float
    ) -> list[tuple[DiagnosticAddress, bytes]]:
        if self.functional_address is None:
            raise UnsupportedOperationError(
                "No DoIP functional address configured; functional requests are disabled"
            )
        client = self._require()
        await client.send_diagnostic(self.functional_address, payload)
        responses: list[tuple[DiagnosticAddress, bytes]] = []
        for address in self.candidate_addresses():
            try:
                responses.append((address, await client.recv_diagnostic(address.response, timeout)))
            except DiagnosticTimeoutError:
                continue
        return responses

    def candidate_addresses(self) -> Sequence[DiagnosticAddress]:
        addresses = list(self.target_addresses)
        if self.client.entity_address is not None and self.client.entity_address not in addresses:
            addresses.insert(0, self.client.entity_address)
        return [DiagnosticAddress(a, a, TransportProtocol.DOIP) for a in addresses]

    async def passive_listen(self, duration: float) -> set[int]:
        return set()

    async def status(self) -> InterfaceStatus:
        return InterfaceStatus(
            kind=self.kind,
            connected=self.client.connected,
            simulation=self.simulation,
            description=f"DoIP {self.client.host}:{self.client.port}",
            frames_sent=self._sent,
            frames_received=self._received,
            errors=self._errors,
            timeouts=self._timeouts,
            last_error=self._last_error,
            protocols=["DoIP (ISO 13400-2)", "UDS (ISO 14229-1)"],
        )
