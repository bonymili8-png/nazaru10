"""Linux SocketCAN bus (raw CAN_RAW sockets, classic CAN and CAN-FD) using only the standard library.

HARDWARE STATUS: frame packing is unit tested; the socket path is exercised against ``vcan`` where
the kernel provides it. It has not been validated against a vehicle in this repository — see
docs/HARDWARE.md before connecting to a car.
"""

from __future__ import annotations

import asyncio
import socket
import struct

from jlr_diagnostic_core.transports.can import CanAddressPlan, CANInterface
from jlr_protocols.can import CanFrame
from jlr_protocols.isotp import IsoTpConfig
from jlr_shared_types.errors import DiagnosticConnectionError
from jlr_shared_types.models import InterfaceKind

CAN_EFF_FLAG = 0x80000000
CAN_RTR_FLAG = 0x40000000
CAN_ERR_FLAG = 0x20000000
CAN_EFF_MASK = 0x1FFFFFFF
CANFD_BRS = 0x01
_CAN_FRAME = struct.Struct("=IB3x8s")
_CANFD_FRAME = struct.Struct("=IBB2x64s")
CAN_MTU = _CAN_FRAME.size  # 16
CANFD_MTU = _CANFD_FRAME.size  # 72
SOL_CAN_RAW = 101
CAN_RAW_FD_FRAMES = 5


def pack_frame(frame: CanFrame) -> bytes:
    can_id = frame.arbitration_id | (CAN_EFF_FLAG if frame.is_extended_id else 0)
    if frame.is_fd:
        flags = CANFD_BRS if frame.bitrate_switch else 0
        return _CANFD_FRAME.pack(can_id, len(frame.data), flags, frame.data.ljust(64, b"\x00"))
    return _CAN_FRAME.pack(can_id, len(frame.data), frame.data.ljust(8, b"\x00"))


def unpack_frame(raw: bytes) -> CanFrame | None:
    """Decode a kernel frame; error and RTR frames are ignored (``None``)."""

    if len(raw) == CANFD_MTU:
        can_id, length, flags, data = _CANFD_FRAME.unpack(raw)
        is_fd, brs = True, bool(flags & CANFD_BRS)
    elif len(raw) == CAN_MTU:
        can_id, length, data = _CAN_FRAME.unpack(raw)
        is_fd, brs = False, False
    else:
        return None
    if can_id & (CAN_ERR_FLAG | CAN_RTR_FLAG):
        return None
    extended = bool(can_id & CAN_EFF_FLAG)
    return CanFrame(
        can_id & (CAN_EFF_MASK if extended else 0x7FF),
        bytes(data[:length]),
        is_extended_id=extended,
        is_fd=is_fd,
        bitrate_switch=brs,
    )


class SocketCanBus:
    def __init__(self, channel: str = "can0", *, fd: bool = False) -> None:
        self.channel = channel
        self.fd = fd
        self._sock: socket.socket | None = None

    @property
    def supports_fd(self) -> bool:
        return self.fd

    async def open(self) -> None:
        if not hasattr(socket, "AF_CAN"):
            raise DiagnosticConnectionError("SocketCAN is only available on Linux")
        sock = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
        try:
            if self.fd:
                sock.setsockopt(SOL_CAN_RAW, CAN_RAW_FD_FRAMES, 1)
            sock.bind((self.channel,))
        except OSError as exc:
            sock.close()
            raise DiagnosticConnectionError(f"Cannot bind SocketCAN channel {self.channel!r}: {exc}") from exc
        sock.setblocking(False)
        self._sock = sock

    async def close(self) -> None:
        if self._sock is not None:
            self._sock.close()
            self._sock = None

    def _socket(self) -> socket.socket:
        if self._sock is None:
            raise DiagnosticConnectionError("SocketCAN bus is not open")
        return self._sock

    async def send(self, frame: CanFrame) -> None:
        loop = asyncio.get_running_loop()
        try:
            await loop.sock_sendall(self._socket(), pack_frame(frame))
        except OSError as exc:
            raise DiagnosticConnectionError(f"SocketCAN send failed: {exc}") from exc

    async def recv(self, timeout: float | None = None) -> CanFrame | None:
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout(timeout):
                while True:
                    raw = await loop.sock_recv(self._socket(), CANFD_MTU)
                    frame = unpack_frame(raw)
                    if frame is not None:
                        return frame
        except TimeoutError:
            return None
        except OSError as exc:
            raise DiagnosticConnectionError(f"SocketCAN receive failed: {exc}") from exc


def SocketCANInterface(  # noqa: N802 - factory named after the interface it builds
    channel: str = "can0",
    *,
    fd: bool = False,
    address_plan: CanAddressPlan | None = None,
    isotp: IsoTpConfig | None = None,
) -> CANInterface:
    return CANInterface(
        SocketCanBus(channel, fd=fd),
        kind=InterfaceKind.SOCKETCAN,
        description=f"SocketCAN {channel}{' (CAN-FD)' if fd else ''}",
        isotp=isotp or IsoTpConfig(tx_dl=64 if fd else 8),
        address_plan=address_plan,
        # SocketCAN exposes no supply voltage; the service falls back to OBD PID 0x42 when available.
        voltage_provider=None,
    )
