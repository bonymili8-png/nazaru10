"""CAN / CAN-FD frames, the bus abstraction and a frame router.

The router owns the single reader of a bus and fans frames out to per-arbitration-ID subscriptions,
so several ISO-TP conversations (e.g. OBD functional responses from several ECUs, or a controlled
number of concurrent discovery probes) can share one physical bus.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Protocol

from jlr_shared_types.errors import DiagnosticConnectionError, DiagnosticTimeoutError, ProtocolError

CAN_FD_LENGTHS: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64)
MAX_STANDARD_ID = 0x7FF
MAX_EXTENDED_ID = 0x1FFFFFFF


def fd_frame_length(payload_length: int) -> int:
    """Smallest valid CAN-FD data length that holds ``payload_length`` bytes."""

    for length in CAN_FD_LENGTHS:
        if length >= payload_length:
            return length
    raise ProtocolError(f"CAN-FD frames carry at most 64 bytes, got {payload_length}")


@dataclass(frozen=True, slots=True)
class CanFrame:
    arbitration_id: int
    data: bytes
    is_extended_id: bool = False
    is_fd: bool = False
    bitrate_switch: bool = False
    timestamp: float = field(default_factory=time.monotonic, compare=False)

    def __post_init__(self) -> None:
        limit = MAX_EXTENDED_ID if self.is_extended_id else MAX_STANDARD_ID
        if not 0 <= self.arbitration_id <= limit:
            raise ProtocolError(f"Arbitration ID 0x{self.arbitration_id:X} out of range")
        if self.is_fd:
            if len(self.data) not in CAN_FD_LENGTHS:
                raise ProtocolError(f"Invalid CAN-FD data length {len(self.data)}")
        elif len(self.data) > 8:
            raise ProtocolError(f"Classic CAN frames carry at most 8 bytes, got {len(self.data)}")

    def __str__(self) -> str:
        width = 8 if self.is_extended_id else 3
        return f"{self.arbitration_id:0{width}X}#{self.data.hex().upper()}"


class CanBus(Protocol):
    """A raw CAN/CAN-FD bus. Implementations: simulated bus, SocketCAN."""

    @property
    def supports_fd(self) -> bool: ...

    async def open(self) -> None: ...

    async def close(self) -> None: ...

    async def send(self, frame: CanFrame) -> None: ...

    async def recv(self, timeout: float | None = None) -> CanFrame | None:
        """Next frame, or ``None`` on timeout. Raises DiagnosticConnectionError when the bus is gone."""
        ...


class Subscription:
    def __init__(self, router: CanFrameRouter, ids: frozenset[int]) -> None:
        self._router = router
        self.ids = ids
        self.queue: asyncio.Queue[CanFrame | Exception] = asyncio.Queue()

    async def get(self, timeout: float) -> CanFrame:
        self._router.raise_if_failed()
        try:
            async with asyncio.timeout(timeout):
                item = await self.queue.get()
        except TimeoutError as exc:
            raise DiagnosticTimeoutError(
                f"No CAN frame on {', '.join(f'0x{i:X}' for i in sorted(self.ids))} within {timeout:.3f}s"
            ) from exc
        if isinstance(item, Exception):
            raise DiagnosticConnectionError(f"CAN bus failed: {item}") from item
        return item

    def drain(self) -> None:
        while not self.queue.empty():
            self.queue.get_nowait()

    def close(self) -> None:
        self._router.unsubscribe(self)


class CanFrameRouter:
    """Single reader for a :class:`CanBus` that routes frames to subscribers by arbitration ID."""

    def __init__(self, bus: CanBus) -> None:
        self.bus = bus
        self._subs: dict[int, list[Subscription]] = {}
        self._monitors: list[asyncio.Queue[CanFrame]] = []
        self._task: asyncio.Task[None] | None = None
        self._failure: Exception | None = None
        self.frames_sent = 0
        self.frames_received = 0

    async def start(self) -> None:
        if self._task is None:
            self._failure = None
            self._task = asyncio.create_task(self._run(), name="can-frame-router")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    @property
    def failure(self) -> Exception | None:
        return self._failure

    def raise_if_failed(self) -> None:
        if self._failure is not None:
            raise DiagnosticConnectionError(f"CAN bus failed: {self._failure}") from self._failure

    async def _run(self) -> None:
        try:
            while True:
                frame = await self.bus.recv(timeout=0.5)
                if frame is None:
                    continue
                self.frames_received += 1
                for monitor in self._monitors:
                    monitor.put_nowait(frame)
                for sub in self._subs.get(frame.arbitration_id, ()):
                    sub.queue.put_nowait(frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # the bus went away: fail every waiter, never hang
            self._failure = exc
            for subs in self._subs.values():
                for sub in subs:
                    sub.queue.put_nowait(exc)

    def subscribe(self, ids: Iterable[int]) -> Subscription:
        sub = Subscription(self, frozenset(ids))
        for arbitration_id in sub.ids:
            self._subs.setdefault(arbitration_id, []).append(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        for arbitration_id in sub.ids:
            subs = self._subs.get(arbitration_id, [])
            if sub in subs:
                subs.remove(sub)
            if not subs:
                self._subs.pop(arbitration_id, None)

    def monitor(self) -> asyncio.Queue[CanFrame]:
        """Receive a copy of every frame (used for passive bus listening)."""

        queue: asyncio.Queue[CanFrame] = asyncio.Queue()
        self._monitors.append(queue)
        return queue

    def stop_monitor(self, queue: asyncio.Queue[CanFrame]) -> None:
        if queue in self._monitors:
            self._monitors.remove(queue)

    async def send(self, frame: CanFrame) -> None:
        self.raise_if_failed()
        await self.bus.send(frame)
        self.frames_sent += 1
