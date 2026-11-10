"""Enlace de invitación para entregar a mano y cambio de correo de una
invitación pendiente, contra PostgreSQL: el token vive en la tabla real y cada
enlace nuevo deja sin efecto al anterior."""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select

from app.db.models.auth import User
from app.db.uow import session_scope
from app.modules.auth.account_actions import (
    INVITATION,
    InvalidActionTokenError,
    UserAlreadyActiveError,
    consume_action_token,
    describe_action_token,
    issue_invitation_link,
    revoke_pending_invitations,
)
from app.modules.auth.errors import EmailAlreadyExistsError
from app.modules.auth.users_repository import update_user
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _pending_user(email: str) -> int:
    async with session_scope() as session:
        user = User(
            email=email,
            name="Invitada",
            password_hash="no-sirve-para-entrar",
            role="vendedor",
            is_active=False,
            created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def _is_active(user_id: int) -> bool:
    async with session_scope() as session:
        return (await session.execute(select(User.is_active).where(User.id == user_id))).scalar_one()


def _token(url: str) -> str:
    return parse_qs(urlsplit(url).query)["token"][0]


async def test_each_link_replaces_the_previous_one_and_activates_the_account(tenant):
    with tenant_context(tenant):
        user_id = await _pending_user("nueva@example.com")

        first = await issue_invitation_link(user_id)
        second = await issue_invitation_link(user_id)
        assert urlsplit(first["url"]).hostname == tenant.hostname
        assert urlsplit(first["url"]).path == "/accept-invitation"

        with pytest.raises(InvalidActionTokenError):
            await describe_action_token(_token(first["url"]))
        described = await describe_action_token(_token(second["url"]))
        assert described == {"purpose": INVITATION, "email": "nueva@example.com", "name": "Invitada"}

        await consume_action_token(token=_token(second["url"]), purpose=INVITATION, password="una-clave-segura")
        assert await _is_active(user_id)

        with pytest.raises(UserAlreadyActiveError):
            await issue_invitation_link(user_id)


async def test_unknown_users_get_no_link(tenant):
    with tenant_context(tenant):
        with pytest.raises(InvalidActionTokenError):
            await issue_invitation_link(999_999)


async def test_changing_the_email_of_a_pending_invitation_revokes_its_link(tenant):
    with tenant_context(tenant):
        user_id = await _pending_user("equivocado@example.com")
        await _pending_user("ocupado@example.com")
        issued = await issue_invitation_link(user_id)

        with pytest.raises(EmailAlreadyExistsError):
            await update_user(user_id, {"email": "ocupado@example.com"})

        saved = await update_user(user_id, {"email": "correcto@example.com"})
        assert saved["email"] == "correcto@example.com"
        await revoke_pending_invitations(user_id)

        # Quien tenga el enlace que fue al correo equivocado ya no activa la cuenta.
        with pytest.raises(InvalidActionTokenError):
            await describe_action_token(_token(issued["url"]))
        assert not await _is_active(user_id)
