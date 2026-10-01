"""Simulated DoIP entity (ISO 13400-2) in front of the simulated ECUs, for testing the DoIP path."""

from __future__ import annotations

import asyncio
import contextlib
import struct
from typing import TYPE_CHECKING

from jlr_protocols.doip import (
    HEADER,
    DoIPMessage,
    PayloadType,
    RoutingActivationCode,
    decode_header,
    diagnostic_message,
    parse_diagnostic_message,
)

if TYPE_CHECKING:
    from jlr_simulator.vehicle import JLRVehicleSimulator


class SimulatedDoIPEntity:
    def __init__(
        self,
        vehicle: JLRVehicleSimulator,
        *,
        host: str = "127.0.0.1",
        port: int = 0,
        logical_address: int = 0x1001,
        require_authentication: bool = False,
    ) -> None:
        self.vehicle = vehicle
        self.host = host
        self.port = port
        self.logical_address = logical_address
        self.require_authentication = require_authentication
        self._server: asyncio.Server | None = None
        self._clients: set[asyncio.Task[None]] = set()

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._handle, self.host, self.port)
        self.port = self._server.sockets[0].getsockname()[1]
        return self.port

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        for task in list(self._clients):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        if task is not None:
            self._clients.add(task)
        tester: int | None = None
        try:
            while True:
                header = await reader.readexactly(HEADER.size)
                version, payload_type, length = decode_header(header)
                payload = await reader.readexactly(length)
                if payload_type == PayloadType.ROUTING_ACTIVATION_REQUEST:
                    source = struct.unpack(">H", payload[:2])[0]
                    code = (
                        RoutingActivationCode.DENIED_MISSING_AUTHENTICATION
                        if self.require_authentication
                        else RoutingActivationCode.SUCCESS
                    )
                    if code == RoutingActivationCode.SUCCESS:
                        tester = source
                    response = struct.pack(">HHB", source, self.logical_address, code) + b"\x00" * 4
                    writer.write(
                        DoIPMessage(PayloadType.ROUTING_ACTIVATION_RESPONSE, response, version).encode()
                    )
                elif payload_type == PayloadType.DIAGNOSTIC_MESSAGE:
                    source, target, data = parse_diagnostic_message(payload)
                    ecu = self.vehicle.ecu_by_doip_address(target)
                    if tester is None or source != tester:
                        nack = struct.pack(">HHB", target, source, 0x02)
                        writer.write(DoIPMessage(PayloadType.DIAGNOSTIC_MESSAGE_NACK, nack, version).encode())
                    elif ecu is None:
                        nack = struct.pack(">HHB", target, source, 0x03)
                        writer.write(DoIPMessage(PayloadType.DIAGNOSTIC_MESSAGE_NACK, nack, version).encode())
                    else:
                        ack = struct.pack(">HHB", target, source, 0x00)
                        writer.write(DoIPMessage(PayloadType.DIAGNOSTIC_MESSAGE_ACK, ack, version).encode())
                        if ecu.spec.request_id not in self.vehicle.faults.silent_ecus:
                            answer = ecu.handle(data)
                            if answer is not None:
                                writer.write(
                                    DoIPMessage(
                                        PayloadType.DIAGNOSTIC_MESSAGE,
                                        diagnostic_message(target, source, answer),
                                        version,
                                    ).encode()
                                )
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            writer.close()
            if task is not None:
                self._clients.discard(task)
