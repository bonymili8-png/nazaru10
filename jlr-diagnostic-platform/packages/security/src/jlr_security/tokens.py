"""Signed access tokens (JWT, HS256) issued by the API after identity verification.

The token carries only the user's internal ID and a token ID. Role and permissions are re-read from
the database on every request, so a role change or deactivation takes effect immediately.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from jlr_shared_types.errors import AuthRequiredError

ALGORITHM = "HS256"
ISSUER = "jlr-diagnostic-platform"
AUDIENCE = "jlr-diagnostic-api"
MIN_SECRET_LENGTH = 32


@dataclass(frozen=True, slots=True)
class TokenClaims:
    user_id: str
    token_id: str
    issued_at: datetime
    expires_at: datetime


def issue_access_token(user_id: str, secret: str, ttl: timedelta, *, now: datetime | None = None) -> str:
    if len(secret) < MIN_SECRET_LENGTH:
        raise ValueError("JWT secret must be at least 32 characters")
    issued = now or datetime.now(UTC)
    payload = {
        "sub": user_id,
        "jti": uuid.uuid4().hex,
        "iat": int(issued.timestamp()),
        "nbf": int(issued.timestamp()),
        "exp": int((issued + ttl).timestamp()),
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> TokenClaims:
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["sub", "jti", "exp", "iat", "iss", "aud"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthRequiredError("Access token expired") from exc
    except jwt.PyJWTError as exc:
        raise AuthRequiredError("Invalid access token") from exc
    return TokenClaims(
        user_id=str(payload["sub"]),
        token_id=str(payload["jti"]),
        issued_at=datetime.fromtimestamp(payload["iat"], UTC),
        expires_at=datetime.fromtimestamp(payload["exp"], UTC),
    )
