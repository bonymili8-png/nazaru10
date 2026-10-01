"""Telegram Mini App identity verification.

Implements the documented ``initData`` check
(https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):

    secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
    hash       = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))

where ``data_check_string`` is every received field except ``hash`` (and ``signature``, which is
covered by a separate Ed25519 scheme) as ``key=value`` lines sorted by key. ``auth_date`` must be
recent. Nothing the frontend sends is trusted before this check passes.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl

from jlr_shared_types.errors import AuthRequiredError

MAX_INIT_DATA_LENGTH = 4096


@dataclass(frozen=True, slots=True)
class TelegramIdentity:
    telegram_id: int
    username: str | None
    first_name: str | None
    last_name: str | None
    language_code: str | None
    auth_date: datetime


def _secret_key(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()


def compute_init_data_hash(fields: dict[str, str], bot_token: str) -> str:
    data_check_string = "\n".join(
        f"{key}={fields[key]}" for key in sorted(fields) if key not in ("hash", "signature")
    )
    return hmac.new(_secret_key(bot_token), data_check_string.encode(), hashlib.sha256).hexdigest()


def verify_init_data(
    init_data: str,
    bot_token: str,
    *,
    max_age: timedelta = timedelta(hours=24),
    now: datetime | None = None,
) -> TelegramIdentity:
    if not bot_token:
        raise AuthRequiredError("Telegram authentication is not configured")
    if not init_data or len(init_data) > MAX_INIT_DATA_LENGTH:
        raise AuthRequiredError("Missing or oversized Telegram initData")
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise AuthRequiredError("Malformed Telegram initData") from exc
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise AuthRequiredError("Duplicate keys in Telegram initData")
    received = fields.get("hash", "")
    expected = compute_init_data_hash(fields, bot_token)
    if not received or not hmac.compare_digest(received, expected):
        raise AuthRequiredError("Telegram initData signature is invalid")
    try:
        auth_date = datetime.fromtimestamp(int(fields["auth_date"]), UTC)
    except (KeyError, ValueError) as exc:
        raise AuthRequiredError("Telegram initData has no valid auth_date") from exc
    current = now or datetime.now(UTC)
    if current - auth_date > max_age:
        raise AuthRequiredError("Telegram initData has expired; reopen the Mini App")
    if auth_date - current > timedelta(minutes=5):
        raise AuthRequiredError("Telegram initData auth_date is in the future")
    try:
        user = json.loads(fields["user"])
        telegram_id = int(user["id"])
    except (KeyError, ValueError, TypeError) as exc:
        raise AuthRequiredError("Telegram initData has no user") from exc
    return TelegramIdentity(
        telegram_id=telegram_id,
        username=user.get("username"),
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        language_code=user.get("language_code"),
        auth_date=auth_date,
    )
