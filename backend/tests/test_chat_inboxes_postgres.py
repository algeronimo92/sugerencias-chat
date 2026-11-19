"""Bandejas de la lista de chats contra PostgreSQL (doc 18 §6.1).

El panel de bandejas del rediseño (estilo Manychat) necesita filtrar por
"sin asignar" y por estado de la conversación, ordenar por quién espera más
y mostrar cuántos chats hay en cada bandeja sin una consulta por bandeja.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import update

from app.db.models.auth import User
from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.conversations.chat_queries import ORDER_WAITING, LeadFilters, fetch_chats
from app.modules.conversations.inbox_queries import fetch_inbox_counts
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _seller(name: str) -> int:
    async with session_scope() as session:
        user = User(
            email=f"{name.lower()}-{uuid4().hex[:6]}@example.test", name=name, password_hash="!",
            role="vendedor", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def _lead(name: str, *, seller_id: int | None = None, open_: bool = False, stage: str = "nuevo",
                last_from: str = "vendedor", minutes_ago: int = 0, read: bool = True) -> str:
    """Un lead con un solo mensaje, de `last_from`, hace `minutes_ago` minutos."""
    lead_id = str(uuid4())
    await ensure_lead_stub(lead_id, None, None)
    sent_at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    async with session_scope() as session:
        await session.execute(
            update(Lead).where(Lead.id == lead_id).values(
                nombre=name, vendedor_id=seller_id, conversacion_abierta=open_, estado=stage,
                last_read_at=sent_at + timedelta(seconds=1) if read else None,
            )
        )
        session.add(WspMessage(chat_id=lead_id, sender=last_from, content="hola", sent_at=sent_at))
    return lead_id


def _names(page: dict) -> list[str]:
    return [item["name"] for item in page["items"]]


async def test_unassigned_and_conversation_state_filter_the_list(tenant) -> None:
    with tenant_context(tenant):
        grecia = await _seller("Grecia")
        await _lead("Asignada abierta", seller_id=grecia, open_=True, minutes_ago=1)
        await _lead("Libre abierta", open_=True, minutes_ago=2)
        await _lead("Libre cerrada", minutes_ago=3)

        assert _names(await fetch_chats(filters=LeadFilters(unassigned=True))) == ["Libre abierta", "Libre cerrada"]
        assert _names(await fetch_chats(filters=LeadFilters(conversation="open"))) == ["Asignada abierta", "Libre abierta"]
        assert _names(await fetch_chats(filters=LeadFilters(conversation="closed"))) == ["Libre cerrada"]
        assert _names(await fetch_chats(filters=LeadFilters(unassigned=True, conversation="open"))) == ["Libre abierta"]


async def test_waiting_order_lists_only_who_waits_oldest_first_and_paginates(tenant) -> None:
    with tenant_context(tenant):
        await _lead("Atendida", last_from="vendedor", minutes_ago=90)
        await _lead("Espera 5 min", last_from="cliente", minutes_ago=5)
        await _lead("Espera 1 h", last_from="cliente", minutes_ago=60)
        await _lead("Espera 20 min", last_from="cliente", minutes_ago=20)

        first = await fetch_chats(limit=2, order=ORDER_WAITING)
        assert _names(first) == ["Espera 1 h", "Espera 20 min"]
        assert first["has_more"] is True

        last = first["items"][-1]
        second = await fetch_chats(
            cursor_ts=last["timestamp"], cursor_id=last["chat_id"], limit=2, order=ORDER_WAITING,
        )
        assert _names(second) == ["Espera 5 min"]
        assert second["has_more"] is False

        # El orden de siempre no cambia.
        assert _names(await fetch_chats())[0] == "Espera 5 min"


async def test_inbox_counts_add_up_and_follow_the_list_filters(tenant) -> None:
    with tenant_context(tenant):
        grecia = await _seller("Grecia")
        antonella = await _seller("Antonella")
        await _lead("Mía sin leer", seller_id=grecia, open_=True, last_from="cliente", read=False, stage="calificado")
        await _lead("Mía leída", seller_id=grecia, stage="calificado")
        await _lead("De Antonella", seller_id=antonella, open_=True, last_from="cliente")
        await _lead("Libre", stage="nuevo")

        counts = await fetch_inbox_counts(LeadFilters(), grecia)
        assert counts == {
            "all": 4, "unread": 1, "mine": 2, "unassigned": 1, "open": 2, "closed": 2, "waiting": 2,
            "stages": {"calificado": 2, "nuevo": 2},
        }

        # Con un filtro activo, los números son los de lo que muestra la lista.
        only_open = await fetch_inbox_counts(LeadFilters(conversation="open"), grecia)
        assert only_open["all"] == len((await fetch_chats(filters=LeadFilters(conversation="open")))["items"]) == 2
        assert only_open["mine"] == 1
        assert only_open["closed"] == 0
