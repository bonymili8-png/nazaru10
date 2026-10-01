"""``python -m jlr_api [migrate|serve|all]`` — run migrations and/or the API server."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config

MIGRATIONS = Path(__file__).parent / "migrations"


def alembic_config(database_url: str | None = None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    url = database_url or os.environ.get("DATABASE_URL", "")
    if url:
        config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


def migrate() -> None:
    command.upgrade(alembic_config(), "head")


def serve() -> None:
    uvicorn.run(
        "jlr_api.app:create_app",
        factory=True,
        host=os.environ.get("API_HOST", "0.0.0.0"),  # noqa: S104 - container entrypoint
        port=int(os.environ.get("API_PORT", "8000")),
        log_config=None,
        access_log=False,
        proxy_headers=True,
        forwarded_allow_ips=os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else "all"
    if action in ("migrate", "all"):
        migrate()
    if action in ("serve", "all"):
        serve()
    if action not in ("migrate", "serve", "all"):
        raise SystemExit("usage: python -m jlr_api [migrate|serve|all]")


if __name__ == "__main__":
    main()
