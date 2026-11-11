"""El buscador de la bandeja contra PostgreSQL.

El 2026-11-11 las vendedoras se quejaron de que no encontraban textos que
ellas mismas habían mandado y que en WhatsApp sí: los leads que matcheaban por
"servicio de interés" tapaban a los mensajes y no decían por qué estaban ahí,
de cada chat salía un solo mensaje y "limpieza facial" no encontraba
"limpiezas faciales". Ahora hay dos secciones, como en WhatsApp: contactos
(por sus datos) y mensajes (uno por fila).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import update

from app.db.models.auth import User
from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.conversations.chat_queries import LeadFilters, fetch_chats, search_chat_messages
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


async def _lead(name: str, *, service: str | None = None, seller_id: int | None = None) -> str:
    lead_id = str(uuid4())
    await ensure_lead_stub(lead_id, None, None)
    async with session_scope() as session:
        await session.execute(
            update(Lead).where(Lead.id == lead_id).values(nombre=name, servicio_interes=service, vendedor_id=seller_id)
        )
    return lead_id


async def _message(chat_id: str, content: str | None, *, sender: str = "vendedor", minutes_ago: int = 0,
                   deleted: bool = False, summary: str | None = None) -> int:
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        message = WspMessage(
            chat_id=chat_id, sender=sender, content=content, sent_at=now - timedelta(minutes=minutes_ago),
            deleted_at=now if deleted else None, analysis={"summary": summary} if summary else None,
        )
        session.add(message)
        await session.flush()
        return message.id


async def test_messages_come_one_per_row_newest_first_and_match_by_words(tenant) -> None:
    with tenant_context(tenant):
        paola = await _lead("Paola")
        vanessa = await _lead("Vanessa")
        promo = await _message(paola, "PROMOCIÓN LIMPIEZA FACIAL A SOLO 100 SOLES", minutes_ago=5)
        pregunta = await _message(paola, "cuáles son los precios de las limpiezas faciales?", sender="cliente", minutes_ago=20)
        incluye = await _message(vanessa, "Incluye limpieza profunda facial y carbón activado", minutes_ago=10)
        await _message(vanessa, "La limpieza del consultorio es diaria", minutes_ago=1)       # falta "facial"
        await _message(vanessa, "limpieza facial eliminada", deleted=True)
        comprobante = await _message(vanessa, None, sender="cliente", minutes_ago=30,
                                     summary="Comprobante de pago por limpieza facial")

        page = await search_chat_messages("LIMPIEZA FACIAL")

        # El chat de Paola sale dos veces: una por cada mensaje.
        assert [hit["message_id"] for hit in page["items"]] == [promo, incluye, pregunta, comprobante]
        assert [hit["chat_id"] for hit in page["items"]] == [paola, vanessa, paola, vanessa]
        assert [hit["sender"] for hit in page["items"]] == ["vendedor", "vendedor", "cliente", "cliente"]
        assert page["items"][0]["name"] == "Paola"
        assert page["items"][0]["text"] == "PROMOCIÓN LIMPIEZA FACIAL A SOLO 100 SOLES"
        # Un adjunto sin texto se encuentra por lo que la IA describió de él.
        assert page["items"][3]["text"] == "Comprobante de pago por limpieza facial"
        assert page == page | {"total": 4, "total_capped": False, "has_more": False}


async def test_message_results_paginate_without_repeating(tenant) -> None:
    with tenant_context(tenant):
        lead = await _lead("Paola")
        ids = [await _message(lead, f"botox promo {index}", minutes_ago=index) for index in range(5)]

        first = await search_chat_messages("botox", limit=2)
        last = first["items"][-1]
        second = await search_chat_messages("botox", last["sent_at"], last["message_id"], limit=2)

        assert [hit["message_id"] for hit in first["items"]] == ids[:2]
        assert first["has_more"] is True and first["total"] == 5
        assert [hit["message_id"] for hit in second["items"]] == ids[2:4]
        # El total solo viaja en la primera página.
        assert second["total"] is None


async def test_contacts_are_leads_matching_by_their_own_data_with_the_total(tenant) -> None:
    with tenant_context(tenant):
        grecia = await _seller("Grecia")
        por_servicio = await _lead("Rocío", service="Limpieza Facial", seller_id=grecia)
        por_nombre = await _lead("Limpieza Facial Spa")
        solo_por_mensaje = await _lead("Keyla")
        await _message(solo_por_mensaje, "quiero una limpieza facial")
        await _lead("Cecilia", service="Botox")

        contacts = await fetch_chats("limpieza facial", search_in="contacts")

        # Primero quien se llama así, después quien lo tiene como servicio; el
        # lead que solo lo menciona en un mensaje no es un contacto.
        assert [chat["chat_id"] for chat in contacts["items"]] == [por_nombre, por_servicio]
        assert [chat["search_rank"] for chat in contacts["items"]] == [2, 1]
        assert contacts["total"] == 2

        # Las palabras pueden repartirse entre campos: vendedora y servicio.
        across = await fetch_chats("grecia facial", search_in="contacts")
        assert [chat["chat_id"] for chat in across["items"]] == [por_servicio]

        # Sin `search_in`, la lista mezclada que piden las versiones anteriores.
        legacy = await fetch_chats("limpieza facial")
        assert {chat["chat_id"] for chat in legacy["items"]} == {por_nombre, por_servicio, solo_por_mensaje}
        assert legacy["total"] is None


async def test_both_sections_respect_the_inbox_filters(tenant) -> None:
    """Con "Mis leads" activo, el buscador no muestra mensajes de chats ajenos."""
    with tenant_context(tenant):
        grecia = await _seller("Grecia")
        antonella = await _seller("Antonella")
        de_grecia = await _lead("Paola", service="Botox", seller_id=grecia)
        de_antonella = await _lead("Vanessa", service="Botox", seller_id=antonella)
        mine = await _message(de_grecia, "promo botox", minutes_ago=2)
        await _message(de_antonella, "promo botox", minutes_ago=1)
        # Paola espera respuesta: su último mensaje es de ella.
        await _message(de_grecia, "sigue la promo?", sender="cliente")

        filters = LeadFilters(seller_id=grecia)
        messages = await search_chat_messages("botox", filters=filters)
        contacts = await fetch_chats("botox", filters=filters, search_in="contacts")

        assert [hit["message_id"] for hit in messages["items"]] == [mine]
        assert messages["total"] == 1
        assert [chat["chat_id"] for chat in contacts["items"]] == [de_grecia]

        # Un filtro que mira el último mensaje del chat también aplica.
        waiting = await search_chat_messages("botox", filters=LeadFilters(last_sender="cliente"))
        assert [hit["message_id"] for hit in waiting["items"]] == [mine]


async def test_a_single_letter_does_not_search_the_whole_history(tenant) -> None:
    with tenant_context(tenant):
        lead = await _lead("Paola")
        await _message(lead, "a")

        assert await search_chat_messages("a") == {"items": [], "has_more": False, "total": 0, "total_capped": False}
