"""API configuration from environment variables."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from jlr_shared_types.permissions import Role


class ApiSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+asyncpg://jlr:jlr@localhost:5432/jlr_diagnostics"
    jwt_secret: str = Field(min_length=32)
    access_token_ttl_minutes: int = Field(default=60, ge=5, le=24 * 60)

    telegram_bot_token: str = ""
    init_data_max_age_seconds: int = Field(default=24 * 3600, ge=60)
    allow_dev_auth: bool = False
    admin_telegram_ids: str = ""  # comma-separated Telegram user IDs that get the admin role
    default_role: Role = Role.VIEWER

    gateway_url: str = "http://localhost:8100"
    gateway_token: str = Field(min_length=16)
    gateway_timeout_seconds: float = 120.0

    cors_origins: str = ""  # comma-separated; the Mini App is normally served from the same origin
    log_level: str = "INFO"
    log_json: bool = True
    rate_limit_enabled: bool = True

    @model_validator(mode="after")
    def _production_guards(self) -> ApiSettings:
        if self.environment == "production":
            if self.allow_dev_auth:
                raise ValueError("ALLOW_DEV_AUTH must be false in production")
            if not self.telegram_bot_token:
                raise ValueError("TELEGRAM_BOT_TOKEN is required in production")
            if "change-me" in self.jwt_secret or "dev-only" in self.jwt_secret:
                raise ValueError("JWT_SECRET still has a development placeholder value")
        return self

    def admin_ids(self) -> set[int]:
        return {int(v) for v in self.admin_telegram_ids.split(",") if v.strip()}

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
