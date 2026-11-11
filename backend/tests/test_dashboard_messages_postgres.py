"""Mensajes del negocio por origen en el dashboard, contra PostgreSQL.

El 2026-11-10 el gráfico de mensajes marcaba 0 un día en que los flujos y el
celular habían mandado decenas: contaba solo los enviados desde la app. La
serie por origen usa la misma regla que el rótulo de cada burbuja del chat.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import update

from app.db.models.auth import User
from app.db.models.conversations import MessageOutbox, WspMessage
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.leads.dashboard.activity_queries import collect
from app.modules.leads.dashboard import hours_queries
from app.modules.leads.dashboard.scope import build_scope
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _user(name: str) -> int:
    async with session_scope() as session:
        user = User(
            email=f"{name.lower()}-{uuid4().hex[:6]}@example.test", name=name, password_hash="!",
            role="vendedor", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def _lead(seller_id: int | None) -> str:
    lead_id = str(uuid4())
    await ensure_lead_stub(lead_id, None, None)
    async with session_scope() as session:
        await session.execute(update(Lead).where(Lead.id == lead_id).values(vendedor_id=seller_id))
    return lead_id


async def _message(chat_id: str, *, sender: str = "vendedor", author: int | None = None,
                   dedupe_key: str | None = None, outbox: bool = False, days_ago: int = 0,
                   outbox_status: str | None = None, meta_status: str | None = None) -> None:
    async with session_scope() as session:
        message = WspMessage(
            chat_id=chat_id, sender=sender, content="hola", sent_by_user_id=author,
            outbox_status=outbox_status, meta_status=meta_status,
            sent_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
        )
        session.add(message)
        await session.flush()
        if outbox or dedupe_key:
            session.add(MessageOutbox(message_id=message.id, chat_id=chat_id, payload={}, status="sent", dedupe_key=dedupe_key))


async def test_messages_by_origin_count_flows_phone_and_app_per_day(tenant) -> None:
    with tenant_context(tenant):
        grecia = await _user("Grecia")
        antonella = await _user("Antonella")
        de_grecia = await _lead(grecia)
        de_antonella = await _lead(antonella)
        await _message(de_grecia, author=grecia, outbox=True)                          # app
        await _message(de_grecia, dedupe_key="automation:7:0:0:0")                     # flujo
        await _message(de_grecia, dedupe_key="automation:7:1:0:0")                     # flujo
        await _message(de_grecia, outbox=True)                                         # flujo viejo, sin clave
        await _message(de_grecia, author=grecia, dedupe_key="scheduled:3")             # programado
        await _message(de_grecia)                                                      # eco del celular
        await _message(de_antonella)                                                   # eco, otro chat
        await _message(de_grecia, sender="cliente")                                    # cliente: no cuenta
        await _message(de_grecia, days_ago=1)                                          # ayer

        team = (await collect(build_scope(7, "team", grecia)))["messages"]["by_origin"]
        assert len(team) == 7
        assert team[-1] | {"date": None} == {"date": None, "app": 1, "automation": 3, "scheduled": 1, "phone": 2}
        assert team[-2]["phone"] == 1
        # La serie vieja sigue contando solo lo que tiene autor.
        assert (await collect(build_scope(7, "team", grecia)))["messages"]["trend"][-1]["value"] == 2

        mine = (await collect(build_scope(7, "mine", antonella)))["messages"]["by_origin"]
        assert mine[-1] | {"date": None} == {"date": None, "app": 0, "automation": 0, "scheduled": 0, "phone": 1}


async def test_messages_that_never_went_out_are_not_counted_as_sent(tenant) -> None:
    """Un envío que agotó reintentos, se descartó o Meta rechazó no llegó al
    cliente: no es un mensaje enviado, ni en el gráfico ni en el ranking."""
    with tenant_context(tenant):
        grecia = await _user("Grecia")
        chat = await _lead(grecia)
        await _message(chat, author=grecia, outbox=True, outbox_status="sent", meta_status="read")
        await _message(chat, author=grecia, outbox=True, outbox_status="queued")              # todavía puede salir
        await _message(chat, author=grecia, outbox=True, outbox_status="failed")
        await _message(chat, author=grecia, outbox=True, outbox_status="discarded")
        await _message(chat, author=grecia, outbox=True, outbox_status="sent", meta_status="failed")
        await _message(chat, dedupe_key="automation:9:0:0:0", outbox_status="failed")
        await _message(chat, meta_status="delivered")                                         # eco del celular

        messages = (await collect(build_scope(7, "team", grecia)))["messages"]
        assert messages["by_origin"][-1] | {"date": None} == {"date": None, "app": 2, "automation": 0, "scheduled": 0, "phone": 1}
        assert messages["trend"][-1]["value"] == 2
        assert messages["by_user"] == [{"name": "Grecia", "value": 2}]


async def test_hours_count_only_what_a_person_wrote_and_sent_right_then(tenant) -> None:
    """El mapa "a qué hora se escribe en el CRM" responde cuándo trabaja
    alguien en la app. Un programado tiene autora pero salió solo, y un flujo o
    un eco del celular no los escribió nadie en el CRM a esa hora."""
    with tenant_context(tenant):
        grecia = await _user("Grecia")
        antonella = await _user("Antonella")
        de_antonella = await _lead(antonella)
        await _message(de_antonella, author=grecia, outbox=True)                # a mano, en chat ajeno
        await _message(de_antonella, author=grecia, outbox=True)
        await _message(de_antonella, author=antonella, outbox=True)
        await _message(de_antonella, author=grecia, dedupe_key="scheduled:3")   # programado
        await _message(de_antonella, dedupe_key="automation:7:0:0:0")           # flujo
        await _message(de_antonella)                                            # eco del celular
        await _message(de_antonella, author=grecia, outbox=True, outbox_status="failed")
        await _message(de_antonella, sender="cliente")

        def total(hours: dict) -> int:
            return sum(cell["messages"] for cell in hours["cells"])

        assert total(await hours_queries.collect(build_scope(7, "team", grecia))) == 3
        # Por autora, no por dueña del chat: Grecia escribió en un chat de Antonella.
        assert total(await hours_queries.collect(build_scope(7, "mine", grecia))) == 2
        of_antonella = await hours_queries.collect(build_scope(7, "mine", antonella))
        assert total(of_antonella) == 1
        # La escala es la de quien más escribió, también al mirar a otra
        # persona: así el mapa de Antonella se ve más claro que el de Grecia.
        assert of_antonella["person_peaks"]["messages"] == 2


async def test_hours_count_phone_messages_by_owner_of_the_chat(tenant) -> None:
    """Quien atiende desde el celular salía en blanco en el mapa de lo escrito
    en el CRM. El eco no trae autora: se atribuye a la dueña del chat."""
    with tenant_context(tenant):
        grecia = await _user("Grecia")
        antonella = await _user("Antonella")
        de_grecia = await _lead(grecia)
        de_antonella = await _lead(antonella)
        sin_duena = await _lead(None)
        await _message(de_grecia)                                    # eco
        await _message(de_grecia)
        await _message(de_grecia, meta_status="failed")              # no salió
        await _message(de_antonella)
        await _message(sin_duena)                                    # del equipo, de nadie
        await _message(de_grecia, author=grecia, outbox=True)        # CRM
        await _message(de_grecia, dedupe_key="automation:7:0:0:0")   # flujo
        await _message(de_grecia, sender="cliente")

        def total(hours: dict) -> int:
            return sum(cell["phone_messages"] for cell in hours["cells"])

        team = await hours_queries.collect(build_scope(7, "team", grecia))
        assert total(team) == 4
        assert total(await hours_queries.collect(build_scope(7, "mine", grecia))) == 2
        of_antonella = await hours_queries.collect(build_scope(7, "mine", antonella))
        assert total(of_antonella) == 1
        assert of_antonella["person_peaks"]["phone_messages"] == 2
