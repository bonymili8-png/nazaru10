"""Application context and request dependencies: DB session, authentication, permissions, limits."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from jlr_api.db.models import User
from jlr_api.gateway_client import GatewayClient
from jlr_api.settings import ApiSettings
from jlr_security import RateLimiter, decode_access_token
from jlr_security.rate_limit import Limit
from jlr_shared_types.errors import AuthRequiredError, PermissionDeniedError
from jlr_shared_types.permissions import Permission, permissions_for

DEFAULT_LIMITS = {
    "auth": Limit(20, 60),
    "scan": Limit(6, 60),
    "mutation": Limit(10, 60),
    "live": Limit(240, 60),
    "default": Limit(300, 60),
}


@dataclass
class AppContext:
    settings: ApiSettings
    sessions: async_sessionmaker[AsyncSession]
    gateway: GatewayClient
    limiter: RateLimiter


@dataclass(frozen=True)
class CurrentUser:
    user: User
    permissions: frozenset[Permission]

    @property
    def id(self) -> uuid.UUID:
        return self.user.id

    def has(self, permission: Permission) -> bool:
        return permission in self.permissions


def get_context(request: Request) -> AppContext:
    context: AppContext = request.app.state.context
    return context


Ctx = Annotated[AppContext, Depends(get_context)]


async def get_db(ctx: Ctx) -> AsyncIterator[AsyncSession]:
    async with ctx.sessions() as session:
        yield session


Db = Annotated[AsyncSession, Depends(get_db)]


async def current_user(
    ctx: Ctx, db: Db, authorization: Annotated[str | None, Header()] = None
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthRequiredError("Missing bearer token")
    claims = decode_access_token(authorization[7:].strip(), ctx.settings.jwt_secret)
    try:
        user_id = uuid.UUID(claims.user_id)
    except ValueError as exc:
        raise AuthRequiredError("Invalid access token subject") from exc
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthRequiredError("User not found or deactivated")
    return CurrentUser(user=user, permissions=permissions_for(user.role))


Auth = Annotated[CurrentUser, Depends(current_user)]


def require(permission: Permission) -> Callable[[CurrentUser], Awaitable[CurrentUser]]:
    async def dependency(user: Auth) -> CurrentUser:
        if not user.has(permission):
            raise PermissionDeniedError(
                f"This action requires the {permission.value} permission",
                details={"permission": permission.value, "role": user.user.role},
            )
        return user

    return dependency


def rate_limited(bucket: str) -> Callable[[Request, AppContext, CurrentUser], Awaitable[None]]:
    async def dependency(request: Request, ctx: Ctx, user: Auth) -> None:
        if ctx.settings.rate_limit_enabled:
            ctx.limiter.check(bucket, str(user.id))

    return dependency


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
