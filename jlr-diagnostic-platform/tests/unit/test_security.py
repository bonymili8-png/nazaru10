from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import pytest

from jlr_security import (
    RateLimiter,
    compute_init_data_hash,
    decode_access_token,
    issue_access_token,
    verify_init_data,
)
from jlr_security.rate_limit import Limit
from jlr_shared_types.errors import AuthRequiredError, RateLimitedError

BOT_TOKEN = "123456:TEST-bot-token"
SECRET = "x" * 40


def signed_init_data(user_id: int = 42, *, auth_date: datetime | None = None, token: str = BOT_TOKEN) -> str:
    fields = {
        "query_id": "AAH",
        "user": json.dumps({"id": user_id, "first_name": "Test", "username": "tester"}),
        "auth_date": str(int((auth_date or datetime.now(UTC)).timestamp())),
    }
    fields["hash"] = compute_init_data_hash(fields, token)
    return urlencode(fields)


def test_valid_init_data() -> None:
    identity = verify_init_data(signed_init_data(), BOT_TOKEN)
    assert identity.telegram_id == 42
    assert identity.username == "tester"


def test_init_data_signed_with_other_bot_rejected() -> None:
    with pytest.raises(AuthRequiredError, match="signature"):
        verify_init_data(signed_init_data(token="999:OTHER"), BOT_TOKEN)


def test_tampered_init_data_rejected() -> None:
    tampered = signed_init_data().replace("%22id%22%3A+42", "%22id%22%3A+1")
    with pytest.raises(AuthRequiredError):
        verify_init_data(tampered, BOT_TOKEN)


def test_expired_init_data_rejected() -> None:
    old = signed_init_data(auth_date=datetime.now(UTC) - timedelta(days=2))
    with pytest.raises(AuthRequiredError, match="expired"):
        verify_init_data(old, BOT_TOKEN)


@pytest.mark.parametrize("raw", ["", "a" * 5000, "hash=abc", "no-equals-sign"])
def test_malformed_init_data_rejected(raw: str) -> None:
    with pytest.raises(AuthRequiredError):
        verify_init_data(raw, BOT_TOKEN)


def test_missing_bot_token_rejected() -> None:
    with pytest.raises(AuthRequiredError, match="not configured"):
        verify_init_data(signed_init_data(), "")


def test_access_token_round_trip() -> None:
    token = issue_access_token("user-1", SECRET, timedelta(minutes=5))
    claims = decode_access_token(token, SECRET)
    assert claims.user_id == "user-1"
    with pytest.raises(AuthRequiredError):
        decode_access_token(token, "y" * 40)
    with pytest.raises(AuthRequiredError, match="expired"):
        decode_access_token(
            issue_access_token("u", SECRET, timedelta(minutes=5), now=datetime.now(UTC) - timedelta(hours=1)),
            SECRET,
        )
    with pytest.raises(ValueError, match="32"):
        issue_access_token("u", "short", timedelta(minutes=5))


def test_rate_limiter_window() -> None:
    limiter = RateLimiter({"scan": Limit(2, 60)})
    limiter.check("scan", "u", now=0)
    limiter.check("scan", "u", now=1)
    with pytest.raises(RateLimitedError) as info:
        limiter.check("scan", "u", now=2)
    assert info.value.details["retry_after_seconds"] == pytest.approx(58)
    limiter.check("scan", "other", now=2)
    limiter.check("scan", "u", now=61)
    limiter.check("unlimited-bucket", "u", now=0)
