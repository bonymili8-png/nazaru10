"""Protocol stack: CAN / CAN-FD, ISO-TP, UDS, OBD-II and DoIP.

Layering (each layer only knows the one below it)::

    UDS / OBD-II          (jlr_protocols.uds, jlr_protocols.obd)
        |
    ISO-TP  |  DoIP       (jlr_protocols.isotp, jlr_protocols.doip)
        |        |
    CAN/CAN-FD  TCP       (jlr_protocols.can)
"""

PROTOCOL_VERSIONS: dict[str, str] = {
    "uds": "ISO 14229-1 (client subset)",
    "isotp": "ISO 15765-2 (normal addressing, classic CAN + CAN-FD)",
    "obd": "SAE J1979 / ISO 15031-5 on ISO 15765-4",
    "doip": "ISO 13400-2:2012 (TCP, no TLS)",
}
