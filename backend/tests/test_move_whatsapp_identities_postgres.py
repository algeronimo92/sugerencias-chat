"""La misma línea vuelve con otro ``phone_number_id`` y los chats siguen ahí.

El 20-11-2026 DermicaPro borró la cuenta de WhatsApp del celular: Meta eliminó
la cuenta de WhatsApp Business de los chats y, al darla de alta de nuevo, el
mismo teléfono apareció con un id distinto. La lista de chats solo muestra los
leads vistos en el número activo, así que sin mover los contactos al id nuevo
la bandeja quedaba vacía con todo el historial en la base.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.db.models.conversations import WspMessage
from app.db.models.leads import WhatsAppIdentity
from app.db.uow import session_scope
from app.integrations.whatsapp.identity import WA_ID, ContactIdentity, add_identity_alias, resolve_whatsapp_identity
from app.modules.conversations.chat_queries import fetch_chats
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.platform.settings_service import update_settings
from app.tenancy.context import tenant_context
from scripts.move_whatsapp_identities import check_move, identities_by_number, move_identities
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

OLD_NUMBER = "100000000007940"
NEW_NUMBER = "100000000002499"
NOTICE_NUMBER = "100000000009923"


async def _client(name: str, wa_id: str, *, number: str = OLD_NUMBER) -> str:
    """Un lead que escribió por ``number``, con un mensaje en su chat."""
    resolved = await resolve_whatsapp_identity(
        ContactIdentity(phone_number_id=number, wa_id=wa_id, user_id=None, profile_name=name)
    )
    async with session_scope() as session:
        session.add(WspMessage(
            chat_id=resolved.chat_id, sender="cliente", content="hola", sent_at=datetime.now(timezone.utc),
        ))
    return resolved.chat_id


async def _names() -> list[str]:
    return sorted(item["name"] for item in (await fetch_chats())["items"])


async def _number_of(lead_id: str) -> str:
    async with session_scope() as session:
        return (await session.execute(
            select(WhatsAppIdentity.phone_number_id).where(WhatsAppIdentity.lead_id == lead_id)
        )).scalar_one()


async def test_chats_of_the_old_number_show_again_after_moving_them_to_the_new_one(tenant) -> None:
    with tenant_context(tenant):
        await update_settings({"meta_phone_number_id": OLD_NUMBER})
        ana = await _client("Ana", "51900000001")
        await _client("Beto", "51900000002")
        assert await _names() == ["Ana", "Beto"]

        # La línea se dio de alta de nuevo: Meta le puso otro id.
        await update_settings({"meta_phone_number_id": NEW_NUMBER})
        assert await _names() == []
        assert await identities_by_number() == {OLD_NUMBER: (2, 2)}

        assert await move_identities(OLD_NUMBER, NEW_NUMBER) == 2

        assert await _names() == ["Ana", "Beto"]
        assert await identities_by_number() == {NEW_NUMBER: (2, 2)}
        # Ana vuelve a escribir, ya por el número nuevo: es el mismo lead.
        again = await resolve_whatsapp_identity(
            ContactIdentity(phone_number_id=NEW_NUMBER, wa_id="51900000001", user_id=None)
        )
        assert (again.chat_id, again.lead_created) == (ana, False)


async def test_moving_touches_only_the_contacts_of_the_old_number(tenant) -> None:
    with tenant_context(tenant):
        await update_settings({"meta_phone_number_id": NEW_NUMBER})
        old = await _client("Del número viejo", "51900000001")
        notice = await _client("Del número de avisos", "51900000002", number=NOTICE_NUMBER)
        # Creado a mano, todavía sin eventos de Meta.
        manual = str(uuid4())
        await ensure_lead_stub(manual, None, None)
        await add_identity_alias(manual, "", WA_ID, "51900000003")

        assert await move_identities(OLD_NUMBER, NEW_NUMBER) == 1

        assert await _number_of(old) == NEW_NUMBER
        assert await _number_of(notice) == NOTICE_NUMBER
        assert await _number_of(manual) == "*"
        # Repetirlo no hace nada.
        assert await move_identities(OLD_NUMBER, NEW_NUMBER) == 0


@pytest.mark.parametrize(("source", "target"), [
    (OLD_NUMBER, OLD_NUMBER),
    ("*", NEW_NUMBER),
    (OLD_NUMBER, "*"),
    ("", NEW_NUMBER),
    (OLD_NUMBER, ""),
])
def test_a_move_that_makes_no_sense_is_refused(source: str, target: str) -> None:
    with pytest.raises(ValueError):
        check_move(source, target)
