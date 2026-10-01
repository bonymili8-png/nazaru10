"""Virtual CAN network: the tester-side :class:`SimulatedCanBus` and one ISO-TP server node per ECU.

ECU nodes run the same ISO-TP implementation as the tester (in the server role), so every scan
through the simulator exercises real segmentation, flow control and reassembly. Fault injection
(silence, delays, responsePending, corrupt payloads, interrupted multi-frame transfers, adapter
disconnect) is applied here, at the "wire".
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING

from jlr_protocols.can import CanFrame
from jlr_protocols.isotp import FrameType, IsoTpChannel, IsoTpConfig, parse_frame
from jlr_protocols.obd import OBD_FUNCTIONAL_REQUEST_ID
from jlr_shared_types.errors import DiagnosticConnectionError, DiagnosticTimeoutError, ProtocolError
from jlr_simulator.ecu import SimulatedEcu

if TYPE_CHECKING:
    from jlr_simulator.state import SimulationFaults

_DISCONNECT = object()


class _NodeSource:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[CanFrame] = asyncio.Queue()
        self.pushback: bytes | None = None

    async def get(self, timeout: float) -> bytes:
        if self.pushback is not None:
            data, self.pushback = self.pushback, None
            return data
        try:
            async with asyncio.timeout(timeout):
                return (await self.queue.get()).data
        except TimeoutError as exc:
            raise DiagnosticTimeoutError("simulated ECU timed out waiting for a frame") from exc


class EcuNode:
    def __init__(self, ecu: SimulatedEcu, network: VirtualCanNetwork) -> None:
        self.ecu = ecu
        self.network = network
        self.source = _NodeSource()
        self.channel = IsoTpChannel(self._send_frame, self.source, network.isotp)
        self._task: asyncio.Task[None] | None = None

    @property
    def request_id(self) -> int:
        return self.ecu.spec.request_id

    async def _send_frame(self, data: bytes) -> None:
        faults = self.network.faults
        if self.request_id in faults.interrupt_multiframe and data[0] >> 4 == FrameType.CONSECUTIVE:
            return  # the transfer dies after the first frame: tester hits N_Cr
        self.network.to_tester(CanFrame(self.ecu.spec.response_id, data, is_fd=self.network.isotp.is_fd))

    def start(self) -> None:
        self._task = asyncio.create_task(self._serve(), name=f"sim-ecu-{self.ecu.spec.key}")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _serve(self) -> None:
        while True:
            frame = await self.source.queue.get()
            functional = frame.arbitration_id == OBD_FUNCTIONAL_REQUEST_ID
            try:
                if functional:
                    parsed = parse_frame(frame.data)
                    if parsed.type is not FrameType.SINGLE:
                        continue
                    request = parsed.data
                else:
                    self.source.pushback = frame.data
                    request = await self.channel.recv(timeout=1.0)
            except (ProtocolError, DiagnosticTimeoutError):
                continue
            await self._respond(request, functional)

    async def _respond(self, request: bytes, functional: bool) -> None:
        faults = self.network.faults
        if self.request_id in faults.silent_ecus:
            return
        delay = faults.response_delay.get(self.request_id)
        if delay:
            await asyncio.sleep(delay)
        response = self.ecu.handle(request, functional=functional)
        if response is None:
            return
        try:
            for _ in range(faults.response_pending.get(self.request_id, 0)):
                await self.channel.send(bytes([0x7F, request[0], 0x78]))
                await asyncio.sleep(0.005)
            if self.request_id in faults.corrupt_ecus and len(response) > 1:
                # Positive SID followed by garbage: structurally invalid for every service with a record.
                response = bytes([response[0], 0xEE])
            await self.channel.send(response)
        except (ProtocolError, DiagnosticTimeoutError):
            return  # tester went away mid-transfer


class VirtualCanNetwork:
    def __init__(self, ecus: list[SimulatedEcu], faults: SimulationFaults, isotp: IsoTpConfig) -> None:
        self.faults = faults
        self.isotp = isotp
        self.nodes = [EcuNode(ecu, self) for ecu in ecus]
        self.tester_rx: asyncio.Queue[CanFrame | object] = asyncio.Queue()
        self.started = False

    async def start(self) -> None:
        if not self.started:
            for node in self.nodes:
                node.start()
            self.started = True

    async def stop(self) -> None:
        for node in self.nodes:
            await node.stop()
        self.started = False

    def to_tester(self, frame: CanFrame) -> None:
        if not self.faults.disconnected:
            self.tester_rx.put_nowait(frame)

    def from_tester(self, frame: CanFrame) -> None:
        for node in self.nodes:
            if frame.arbitration_id == node.request_id or (
                frame.arbitration_id == OBD_FUNCTIONAL_REQUEST_ID and node.ecu.spec.obd_pids
            ):
                node.source.queue.put_nowait(frame)

    def signal_disconnect(self) -> None:
        self.tester_rx.put_nowait(_DISCONNECT)


class SimulatedCanBus:
    """The tester's view of the simulated vehicle bus (what a real adapter would provide)."""

    def __init__(self, network: VirtualCanNetwork) -> None:
        self.network = network
        self.is_open = False

    @property
    def supports_fd(self) -> bool:
        return self.network.isotp.is_fd

    def _check(self) -> None:
        if self.network.faults.disconnected:
            raise DiagnosticConnectionError("Simulated adapter disconnected")
        if not self.is_open:
            raise DiagnosticConnectionError("Simulated bus is closed")

    async def open(self) -> None:
        if self.network.faults.disconnected:
            raise DiagnosticConnectionError("Simulated adapter disconnected")
        while not self.network.tester_rx.empty():  # a fresh adapter session starts with an empty buffer
            self.network.tester_rx.get_nowait()
        await self.network.start()
        self.is_open = True

    async def close(self) -> None:
        self.is_open = False
        await self.network.stop()

    async def send(self, frame: CanFrame) -> None:
        self._check()
        self.network.from_tester(frame)
        await asyncio.sleep(0)

    async def recv(self, timeout: float | None = None) -> CanFrame | None:
        self._check()
        try:
            async with asyncio.timeout(timeout):
                item = await self.network.tester_rx.get()
        except TimeoutError:
            return None
        if item is _DISCONNECT:
            raise DiagnosticConnectionError("Simulated adapter disconnected")
        assert isinstance(item, CanFrame)
        return item
