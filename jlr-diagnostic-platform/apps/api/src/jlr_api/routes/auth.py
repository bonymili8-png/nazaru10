"""Authentication: Telegram Mini App initData -> access token (plus a development-only login)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request
from sqlalchemy import select

from jlr_api.context import Auth, Ctx, Db, client_ip
from jlr_api.db.models import User
from jlr_api.schemas import DevAuthIn, MeUpdateIn, TelegramAuthIn, TokenOut, UserOut
from jlr_security import TelegramIdentity, issue_access_token, verify_init_data
from jlr_shared_types.errors import NotFoundError
from jlr_shared_types.permissions import Role, permissions_for

router = APIRouter(tags=["auth"])


def user_out(user: User) -> UserOut:
    out = UserOut.model_validate(user)
    return out.model_copy(update={"permissions": sorted(p.value for p in permissions_for(user.role))})


async def _login(ctx: Ctx, db: Db, identity: TelegramIdentity) -> TokenOut:
    user = await db.scalar(select(User).where(User.telegram_id == identity.telegram_id))
    if user is None:
        user = User(telegram_id=identity.telegram_id, role=Role(ctx.settings.default_role).value)
        db.add(user)
    user.username = identity.username
    user.first_name = identity.first_name
    user.last_name = identity.last_name
    if identity.telegram_id in ctx.settings.admin_ids():
        user.role = Role.ADMIN.value
    user.last_login_at = datetime.now(UTC)
    await db.commit()
    ttl = timedelta(minutes=ctx.settings.access_token_ttl_minutes)
    token = issue_access_token(str(user.id), ctx.settings.jwt_secret, ttl)
    return TokenOut(access_token=token, expires_in=int(ttl.total_seconds()), user=user_out(user))


@router.post("/auth/telegram")
async def telegram_login(body: TelegramAuthIn, request: Request, ctx: Ctx, db: Db) -> TokenOut:
    if ctx.settings.rate_limit_enabled:
        ctx.limiter.check("auth", client_ip(request))
    identity = verify_init_data(
        body.init_data,
        ctx.settings.telegram_bot_token,
        max_age=timedelta(seconds=ctx.settings.init_data_max_age_seconds),
    )
    return await _login(ctx, db, identity)


@router.post("/auth/dev")
async def dev_login(body: DevAuthIn, request: Request, ctx: Ctx, db: Db) -> TokenOut:
    """Development login for running the Mini App outside Telegram. Disabled unless ALLOW_DEV_AUTH."""

    if not ctx.settings.allow_dev_auth or ctx.settings.environment == "production":
        raise NotFoundError("Not found")
    if ctx.settings.rate_limit_enabled:
        ctx.limiter.check("auth", client_ip(request))
    identity = TelegramIdentity(
        telegram_id=body.telegram_id,
        username=body.username,
        first_name=body.first_name,
        last_name=None,
        language_code=None,
        auth_date=datetime.now(UTC),
    )
    return await _login(ctx, db, identity)


@router.get("/me")
async def me(user: Auth) -> UserOut:
    return user_out(user.user)


@router.patch("/me")
async def update_me(body: MeUpdateIn, user: Auth, db: Db) -> UserOut:
    stored = await db.get(User, user.id)
    assert stored is not None
    stored.professional_mode = body.professional_mode
    await db.commit()
    return user_out(stored)
