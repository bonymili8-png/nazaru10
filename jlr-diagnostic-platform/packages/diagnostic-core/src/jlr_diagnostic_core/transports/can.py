"""UDS/OBD over ISO-TP over any :class:`CanBus` (classic CAN or CAN-FD)."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field

from jlr_diagnostic_core.interface import DiagnosticAddress, TransportProtocol
from jlr_protocols.can import CanBus, CanFrame, CanFrameRouter, Subscription
from jlr_protocols.isotp import IsoTpChannel, IsoTpConfig, segment
from jlr_protocols.obd import OBD_FUNCTIONAL_REQUEST_ID, OBD_PHYSICAL_REQUEST_IDS, OBD_RESPONSE_IDS
from jlr_shared_types.errors import (
    DiagnosticConnectionError,
    DiagnosticTimeoutError,
    NotConnectedError,
    ProtocolError,
)
from jlr_shared_types.models import IgnitionState, InterfaceKind, InterfaceStatus

VoltageProvider = Callable[[], Awaitable[float | None]]
IgnitionProvider = Callable[[], Awaitable[IgnitionState]]


@dataclass(frozen=True, slots=True)
class CanAddressPlan:
    """Which request IDs discovery may probe, and how response IDs are derived.

    The default (11-bit 0x700-0x7F7, response = request + 8) is a widespread *convention*, not a
    guarantee: it is a configurable heuristic and discovery additionally skips any ID it saw in use
    on the bus and any ID that turned out to be an ECU's response ID.
    """

    request_start: int = 0x700
    request_end: int = 0x7F7
    response_offset: int = 8
    extended_id: bool = False
    exclude: frozenset[int] = field(default_factory=lambda: frozenset({OBD_FUNCTIONAL_REQUEST_ID}))

    def candidates(self, transport: TransportProtocol) -> list[DiagnosticAddress]:
        limit = 0x1FFFFFFF if self.extended_id else 0x7FF
        return [
            DiagnosticAddress(request, request + self.response_offset, transport, self.extended_id)
            for request in range(self.request_start, self.request_end + 1)
            if request not in self.exclude and request + self.response_offset <= limit
        ]


class _SubscriptionSource:
    def __init__(self, sub: Subscription) -> None:
        self.sub = sub

    async def get(self, timeout: float) -> bytes:
        return (await self.sub.get(timeout)).data


class CANInterface:
    """Diagnostic interface for a raw CAN bus. ``MockInterface`` is this class over a simulated bus."""

    def __init__(
        self,
        bus: CanBus,
        *,
        kind: InterfaceKind = InterfaceKind.CAN,
        description: str = "",
        isotp: IsoTpConfig | None = None,
        address_plan: CanAddressPlan | None = None,
        voltage_provider: VoltageProvider | None = None,
        ignition_provider: IgnitionProvider | None = None,
        voltage_source: str = "ADAPTER",
        simulation: bool = False,
    ) -> None:
        self.kind = kind
        self.bus = bus
        self.description = description
        self.isotp = isotp or IsoTpConfig()
        self.address_plan = address_plan or CanAddressPlan()
        self.transport = TransportProtocol.ISOTP_CAN_FD if self.isotp.is_fd else TransportProtocol.ISOTP_CAN
        self._voltage_provider = voltage_provider
        self._ignition_provider = ignition_provider
        self._voltage_source = voltage_source
        self.simulation = simulation
        self._router: CanFrameRouter | None = None
        self._channels: dict[DiagnosticAddress, tuple[IsoTpChannel, Subscription]] = {}
        self._connected = False
        self._errors = 0
        self._timeouts = 0
        self._last_error: str | None = None
        # Only addresses that have answered before count towards error statistics: silence from an
        # address that never answered is the expected outcome of a discovery probe, not a link error.
        self._responsive: set[DiagnosticAddress] = set()
        self._link_failure: DiagnosticConnectionError | None = None

    # ------------------------------------------------------------------ lifecycle

    async def connect(self) -> None:
        if self._connected:
            if self._router is not None and self._router.failure is None and self._link_failure is None:
                return
            await self.disconnect()  # the previous link failed: rebuild it
        try:
            await self.bus.open()
        except OSError as exc:
            raise DiagnosticConnectionError(f"Cannot open CAN bus: {exc}") from exc
        self._router = CanFrameRouter(self.bus)
        await self._router.start()
        self._connected = True

    async def disconnect(self) -> None:
        if self._router is not None:
            for _, sub in self._channels.values():
                sub.close()
            self._channels.clear()
            self._responsive.clear()
            await self._router.stop()
            self._router = None
        if self._connected:
            with contextlib.suppress(Exception):
                await self.bus.close()
        self._connected = False
        self._link_failure = None

    def _require_router(self) -> CanFrameRouter:
        if not self._connected or self._router is None:
            raise NotConnectedError("Interface is not connected")
        if self._link_failure is not None:
            raise DiagnosticConnectionError(
                f"Vehicle link failed ({self._link_failure.message}); reconnect the interface"
            )
        self._router.raise_if_failed()
        return self._router

    # ------------------------------------------------------------------ channels

    def _channel(self, address: DiagnosticAddress) -> tuple[IsoTpChannel, Subscription]:
        router = self._require_router()
        cached = self._channels.get(address)
        if cached is not None:
            return cached
        sub = router.subscribe([address.response])

        async def send_frame(data: bytes) -> None:
            await router.send(
                CanFrame(
                    address.request,
                    data,
                    is_extended_id=address.extended_id,
                    is_fd=self.isotp.is_fd,
                    bitrate_switch=self.isotp.is_fd,
                )
            )

        channel = IsoTpChannel(send_frame, _SubscriptionSource(sub), self.isotp)
        self._channels[address] = (channel, sub)
        return channel, sub

    def release(self, address: DiagnosticAddress) -> None:
        """Drop the channel of an address that turned out to be absent (keeps the router lean)."""

        cached = self._channels.pop(address, None)
        if cached is not None:
            cached[1].close()

    def _record(self, address: DiagnosticAddress, exc: Exception) -> None:
        if isinstance(exc, DiagnosticConnectionError):
            self._link_failure = exc
            self._errors += 1
            self._last_error = str(exc)
            return
        if address not in self._responsive:
            return
        if isinstance(exc, DiagnosticTimeoutError):
            self._timeouts += 1
        else:
            self._errors += 1
        self._last_error = str(exc)

    async def send(self, address: DiagnosticAddress, payload: bytes) -> None:
        channel, sub = self._channel(address)
        sub.drain()  # discard late frames from an earlier, timed-out exchange
        try:
            await channel.send(payload)
        except (DiagnosticTimeoutError, ProtocolError, DiagnosticConnectionError) as exc:
            self._record(address, exc)
            raise

    async def read(self, address: DiagnosticAddress, timeout: float) -> bytes:
        channel, _ = self._channel(address)
        try:
            data = await channel.recv(timeout)
        except (DiagnosticTimeoutError, ProtocolError, DiagnosticConnectionError) as exc:
            self._record(address, exc)
            raise
        self._responsive.add(address)
        return data

    async def functional_request(
        self, payload: bytes, timeout: float
    ) -> list[tuple[DiagnosticAddress, bytes]]:
        router = self._require_router()
        frames = segment(payload, self.isotp)
        if len(frames) != 1:
            raise ProtocolError("Functional requests must fit a single frame")
        pairs = [
            DiagnosticAddress(req, resp, self.transport)
            for req, resp in zip(OBD_PHYSICAL_REQUEST_IDS, OBD_RESPONSE_IDS, strict=True)
        ]
        channels = [self._channel(address) for address in pairs]
        for _, sub in channels:
            sub.drain()
        try:
            await router.send(CanFrame(OBD_FUNCTIONAL_REQUEST_ID, frames[0], is_fd=self.isotp.is_fd))
        except DiagnosticConnectionError as exc:
            self._record(pairs[0], exc)
            raise

        async def collect(
            address: DiagnosticAddress, channel: IsoTpChannel
        ) -> tuple[DiagnosticAddress, bytes]:
            return address, await channel.recv(timeout)

        results = await asyncio.gather(
            *(collect(address, channel) for address, (channel, _) in zip(pairs, channels, strict=True)),
            return_exceptions=True,
        )
        responses: list[tuple[DiagnosticAddress, bytes]] = []
        for result in results:
            if isinstance(result, DiagnosticConnectionError):
                raise result
            if isinstance(result, BaseException):
                continue  # silence from an OBD address is normal
            responses.append(result)
        return responses

    def candidate_addresses(self) -> Sequence[DiagnosticAddress]:
        return self.address_plan.candidates(self.transport)

    async def passive_listen(self, duration: float) -> set[int]:
        router = self._require_router()
        queue = router.monitor()
        seen: set[int] = set()
        try:
            await asyncio.sleep(duration)
        finally:
            router.stop_monitor(queue)
        while not queue.empty():
            seen.add(queue.get_nowait().arbitration_id)
        return seen

    async def status(self) -> InterfaceStatus:
        voltage = None
        ignition = IgnitionState.UNKNOWN
        failure: Exception | None = self._link_failure or (self._router.failure if self._router else None)
        connected = self._connected and failure is None
        if connected and self._voltage_provider is not None:
            with contextlib.suppress(Exception):
                voltage = await self._voltage_provider()
        if connected and self._ignition_provider is not None:
            with contextlib.suppress(Exception):
                ignition = await self._ignition_provider()
        return InterfaceStatus(
            kind=self.kind,
            connected=connected,
            simulation=self.simulation,
            description=self.description,
            vehicle_voltage=voltage,
            voltage_source=self._voltage_source if voltage is not None else "UNAVAILABLE",
            ignition=ignition,
            frames_sent=self._router.frames_sent if self._router else 0,
            frames_received=self._router.frames_received if self._router else 0,
            errors=self._errors,
            timeouts=self._timeouts,
            last_error=str(failure) if failure else self._last_error,
            protocols=[self.transport.value, "UDS (ISO 14229-1)", "OBD-II (SAE J1979)"],
        )
