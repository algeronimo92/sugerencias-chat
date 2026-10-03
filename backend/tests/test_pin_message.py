"""Fijar mensajes dentro del CRM, contra PostgreSQL real."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import insert, select

from app.db.models.auth import User
from app.db.models.conversations import WspMessage
from app.db.uow import session_scope
from app.modules.conversations.application.inbox import pin_message, unpin_message
from app.modules.conversations.domain.errors import MessageNotFound, PinLimitReached
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _chat_with_messages(count: int, **overrides) -> tuple[str, list[int]]:
    chat_id = str(uuid4())
    await ensure_lead_stub(chat_id, None, None)
    ids = []
    async with session_scope() as session:
        for position in range(count):
            ids.append((await session.execute(insert(WspMessage).values(
                chat_id=chat_id, sender="cliente", content=f"m{position}",
                sent_at=datetime.now(timezone.utc), message_type="text", **overrides,
            ).returning(WspMessage.id))).scalar_one())
    return chat_id, ids


async def _user() -> int:
    async with session_scope() as session:
        user = User(
            email=f"pin-{uuid4().hex[:8]}@example.test", name="Vendedora", password_hash="!",
            role="vendedor", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def _pinned_by(message_id: int):
    async with session_scope() as session:
        return (await session.execute(
            select(WspMessage.pinned_at, WspMessage.pinned_by_user_id).where(WspMessage.id == message_id)
        )).one()


async def test_pin_records_who_and_when_up_to_the_limit(tenant):
    with tenant_context(tenant):
        user_id = await _user()
        chat_id, ids = await _chat_with_messages(4)
        for message_id in ids[:3]:
            await pin_message(chat_id, message_id, user_id=user_id)
        pinned_at, pinned_by = await _pinned_by(ids[0])
        assert pinned_at is not None and pinned_by == user_id

        with pytest.raises(PinLimitReached) as exc:
            await pin_message(chat_id, ids[3], user_id=user_id)
        assert exc.value.status_code == 409
        assert "Desfijá uno primero" in exc.value.detail


async def test_pinning_twice_keeps_its_place_without_rechecking_the_limit(tenant):
    with tenant_context(tenant):
        user_id = await _user()
        chat_id, ids = await _chat_with_messages(3)
        for message_id in ids:
            await pin_message(chat_id, message_id, user_id=user_id)
        first_pinned_at, _ = await _pinned_by(ids[0])

        again = await pin_message(chat_id, ids[0], user_id=await _user())

        assert again["id"] == ids[0]
        assert (await _pinned_by(ids[0]))[0] == first_pinned_at


async def test_unpin_is_idempotent(tenant):
    with tenant_context(tenant):
        chat_id, [message_id] = await _chat_with_messages(1)
        await pin_message(chat_id, message_id, user_id=await _user())

        await unpin_message(chat_id, message_id)
        await unpin_message(chat_id, message_id)

        assert await _pinned_by(message_id) == (None, None)


async def test_missing_or_deleted_messages_cannot_be_pinned(tenant):
    with tenant_context(tenant):
        chat_id, [deleted_id] = await _chat_with_messages(1, deleted_at=datetime.now(timezone.utc))
        with pytest.raises(MessageNotFound):
            await pin_message(chat_id, deleted_id, user_id=1)
        with pytest.raises(MessageNotFound):
            await pin_message(chat_id, 999_999, user_id=1)
        with pytest.raises(MessageNotFound):
            await unpin_message(chat_id, 999_999)
