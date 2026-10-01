"""``python -m jlr_gateway`` — run the gateway with uvicorn."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "jlr_gateway.app:create_app",
        factory=True,
        host=os.environ.get("GATEWAY_HOST", "0.0.0.0"),  # noqa: S104 - container entrypoint
        port=int(os.environ.get("GATEWAY_PORT", "8100")),
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
