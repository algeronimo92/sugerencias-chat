"""Ingesta del webhook de Meta de punta a punta contra un PostgreSQL real.

Aprovisiona un negocio, registra su número en el plano de control y pasa
cada fixture oficial por el mismo camino que un POST de Meta: inbox crudo,
worker, parser por raíz y proyecciones. Se salta si no hay Postgres local
(ver ``test_tenant_postgres_integration``).
"""

from __future__ import annotations

import copy
import secrets

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text

from app.core.config import settings
from app.db.models.control import WebhookInbox
from app.db.models.leads import WhatsAppIdentity
from app.db.models.conversations import WhatsAppMessageEvent, WspMessage
from app.db.session import close_engine, control_session, get_engine, get_sessionmaker
from app.integrations.meta_webhook import metrics
from app.integrations.meta_webhook import processor
from app.integrations.meta_webhook.inbox import claim_events, split_changes, store_changes
from app.integrations.meta_webhook.worker import run_event
from app.tenancy.context import tenant_context, validate_schema_name
from app.tenancy.provisioning import provision_tenant, sync_whatsapp_connection
from tests.meta_fixtures import (
    inbound_cases,
    inbound_message,
    inbound_webhook,
    messages_value,
    status_cases,
    webhook_body,
)
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401


@pytest_asyncio.fixture
async def real_engine(pg_dsn, monkeypatch):  # noqa: F811
    """Como el de test_tenant_postgres_integration pero con un pool normal:
    el flujo completo (identidad, automatizaciones, avisos) abre sesiones
    anidadas y con una sola conexión se bloquearía a sí mismo."""
    monkeypatch.setattr(settings, "database_url", pg_dsn)
    monkeypatch.setattr(settings, "database_ssl", "disable")
    monkeypatch.setattr(settings, "database_pool_size", 5)
    monkeypatch.setattr(settings, "database_max_overflow", 5)
    await close_engine()
    engine = get_engine()
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - diagnóstico de entorno
        await close_engine()
        pytest.skip(f"no se pudo abrir una conexión real contra Postgres: {exc}")
    try:
        yield engine
    finally:
        await close_engine()


@pytest_asyncio.fixture
async def tenant(real_engine, monkeypatch):
    monkeypatch.setattr(settings, "multitenancy_enabled", True)
    suffix = secrets.token_hex(4)
    phone_number_id = f"9{secrets.randbelow(10**14):014d}"
    context = await provision_tenant(
        name=f"Meta Webhook Test {suffix}",
        hostname=f"meta-webhook-{suffix}.integration.test",
    )
    await sync_whatsapp_connection(
        context.organization_id, phone_number_id=phone_number_id, waba_id=f"waba-{suffix}",
    )
    inbox_ids: list[str] = []
    try:
        yield context, phone_number_id, inbox_ids
    finally:
        async with control_session() as session:
            if inbox_ids:
                await session.execute(delete(WebhookInbox).where(WebhookInbox.id.in_(inbox_ids)))
            await session.execute(
                text("DELETE FROM public.organizations WHERE id = :id"),
                {"id": str(context.organization_id)},
            )
        async with real_engine.begin() as connection:
            schema = validate_schema_name(context.schema_name)
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


@pytest.fixture(autouse=True)
def fake_media(monkeypatch):
    downloads: list[str] = []

    async def download_media(media_id: str):
        downloads.append(media_id)
        return b"contenido", "image/jpeg"

    monkeypatch.setattr(processor.meta_service, "download_media", download_media)
    monkeypatch.setattr(processor, "save_decoded_media", lambda content_type, raw, filename=None: f"/media/{len(downloads)}.bin")
    return downloads


def _with_phone_number_id(body: dict, phone_number_id: str) -> dict:
    body = copy.deepcopy(body)
    for entry in body["entry"]:
        for change in entry["changes"]:
            change["value"]["metadata"]["phone_number_id"] = phone_number_id
    return body


async def _deliver(tenant_fixture, body: dict) -> tuple[int, int]:
    """Lo mismo que hace el POST: guardar crudo y procesar lo nuevo."""
    _context, phone_number_id, inbox_ids = tenant_fixture
    accepted, duplicates = await store_changes(split_changes(_with_phone_number_id(body, phone_number_id)))
    inbox_ids.extend(accepted)
    for event in await claim_events(len(accepted) or 1, ids=accepted):
        if not await run_event(event):
            async with control_session() as session:
                error = await session.scalar(select(WebhookInbox.last_error).where(WebhookInbox.id == event.id))
            pytest.fail(f"el evento {event.payload['field']} falló: {error}")
    return len(accepted), duplicates


async def _message(wa_message_id: str) -> WspMessage:
    async with get_sessionmaker()() as session:
        return (
            await session.execute(select(WspMessage).where(WspMessage.wa_message_id == wa_message_id))
        ).scalar_one()


@pytest.mark.asyncio
async def test_every_inbound_root_is_stored_literally(tenant) -> None:
    context, _phone, _ids = tenant
    cases = inbound_cases()
    for name in cases:
        await _deliver(tenant, inbound_webhook(name))

    with tenant_context(context):
        for name, case in cases.items():
            message = case["message"]
            if message["type"] == "reaction":
                continue
            row = await _message(message["id"])
            # Igualdad exacta: lo guardado es lo que mandó Meta.
            assert row.provider_payload == message, name
            assert row.message_type == message["type"], name
            assert row.direction == "inbound"

        text_row = await _message("wamid.TEXT0001")
        assert text_row.content == "Hola, quiero información"

        quick_reply = await _message("wamid.QUICKREPLY1")
        assert (quick_reply.message_type, quick_reply.message_subtype) == ("button", None)
        assert quick_reply.content == "OpcionA"
        assert quick_reply.quoted_wa_message_id == "wamid.TEMPLATE1"

        button_reply = await _message("wamid.BTNREPLY1")
        assert (button_reply.message_type, button_reply.message_subtype) == ("interactive", "button_reply")
        assert (await _message("wamid.LISTREPLY1")).message_subtype == "list_reply"
        assert (await _message("wamid.NFMREPLY1")).message_subtype == "nfm_reply"

        contacts = await _message("wamid.CONTACTS1")
        assert contacts.message_type == "contacts"
        assert contacts.content == "Ana Pérez, Luis Díaz"

        system = await _message("wamid.SYSTEM001")
        assert (system.message_type, system.message_subtype) == ("system", "user_changed_number")

        future = await _message("wamid.FUTURE001")
        assert future.message_type == "poll_v9"
        for literal in ("unknown", "unsupported"):
            row = await _message(inbound_cases()[literal]["message"]["id"])
            assert row.message_type == literal
            assert row.provider_payload["errors"]


@pytest.mark.asyncio
async def test_unknown_types_are_counted_not_rewritten(tenant) -> None:
    counter = metrics.unrendered_messages.labels(message_type="poll_v9", message_subtype="")
    before = counter._value.get()
    await _deliver(tenant, inbound_webhook("future_type"))
    assert counter._value.get() == before + 1


@pytest.mark.asyncio
async def test_replayed_webhook_is_deduplicated(tenant) -> None:
    context, _phone, _ids = tenant
    body = inbound_webhook("text")
    assert await _deliver(tenant, body) == (1, 0)
    assert await _deliver(tenant, body) == (0, 1)
    with tenant_context(context):
        async with get_sessionmaker()() as session:
            count = await session.scalar(
                select(text("count(*)")).select_from(WspMessage).where(WspMessage.wa_message_id == "wamid.TEXT0001")
            )
    assert count == 1


@pytest.mark.asyncio
async def test_identity_uses_exact_meta_identifiers(tenant) -> None:
    context, phone_number_id, _ids = tenant
    await _deliver(tenant, inbound_webhook("text_with_user_id"))
    await _deliver(tenant, inbound_webhook("text_user_id_only"))
    with tenant_context(context):
        first = await _message("wamid.USERID001")
        second = await _message("wamid.USERID002")
        assert first.chat_id == second.chat_id
        async with get_sessionmaker()() as session:
            aliases = {
                (row.kind, row.identifier, row.phone_number_id)
                for row in (
                    await session.execute(
                        select(WhatsAppIdentity).where(WhatsAppIdentity.lead_id == first.chat_id)
                    )
                ).scalars()
            }
    assert aliases == {
        ("wa_id", "51955544433", phone_number_id),
        ("user_id", "PE.1084026510784249", phone_number_id),
    }


@pytest.mark.asyncio
async def test_changed_number_adds_the_new_wa_id(tenant) -> None:
    context, _phone, _ids = tenant
    await _deliver(tenant, inbound_webhook("system"))
    with tenant_context(context):
        system = await _message("wamid.SYSTEM001")
        async with get_sessionmaker()() as session:
            identifiers = set(
                (
                    await session.execute(
                        select(WhatsAppIdentity.identifier).where(WhatsAppIdentity.lead_id == system.chat_id)
                    )
                ).scalars()
            )
    assert identifiers == {"51987654321", "51900011122"}


@pytest.mark.asyncio
async def test_statuses_tolerate_duplicates_and_disorder(tenant) -> None:
    context, _phone, _ids = tenant
    # Un mensaje saliente que el negocio mandó desde el teléfono (eco).
    echo = {
        "from": "51999000111",
        "to": "51987654321",
        "id": "wamid.OUTBOUND1",
        "timestamp": "1790000099",
        "type": "text",
        "text": {"body": "Te escribo desde el teléfono"},
    }
    echo_value = messages_value([], contacts=[])
    echo_value.pop("messages")
    echo_value["message_echoes"] = [echo]
    await _deliver(tenant, webhook_body(echo_value, field="smb_message_echoes"))

    statuses = status_cases()
    # "read" antes que "delivered", y "delivered" dos veces en entregas distintas.
    for name in ("sent", "read", "delivered"):
        await _deliver(tenant, _status_webhook(statuses[name]))
    duplicated = _status_webhook(statuses["delivered"])
    duplicated["entry"][0]["changes"][0]["value"]["statuses"][0]["pricing"] = {"billable": False}
    await _deliver(tenant, duplicated)

    with tenant_context(context):
        row = await _message("wamid.OUTBOUND1")
        assert row.direction == "outbound"
        assert row.provider_payload == echo
        assert row.meta_status == "read"
        assert row.status_payload["status"] == "read"
        async with get_sessionmaker()() as session:
            values = sorted(
                (
                    await session.execute(
                        select(WhatsAppMessageEvent.value).where(
                            WhatsAppMessageEvent.kind == "status",
                            WhatsAppMessageEvent.wa_message_id == "wamid.OUTBOUND1",
                        )
                    )
                ).scalars()
            )
    assert values == ["delivered", "read", "sent"]


def _status_webhook(status: dict) -> dict:
    value = messages_value([], contacts=[])
    value.pop("messages")
    value.pop("contacts")
    value["statuses"] = [copy.deepcopy(status)]
    return webhook_body(value)


@pytest.mark.asyncio
async def test_reaction_is_an_event_and_a_badge(tenant) -> None:
    context, _phone, _ids = tenant
    await _deliver(tenant, inbound_webhook("text"))
    reaction = inbound_message("reaction")
    reaction["reaction"]["message_id"] = "wamid.TEXT0001"
    await _deliver(tenant, webhook_body(messages_value([reaction])))
    with tenant_context(context):
        target = await _message("wamid.TEXT0001")
        assert target.reactions == [{"emoji": "👍", "from_me": False}]
        async with get_sessionmaker()() as session:
            event = (
                await session.execute(
                    select(WhatsAppMessageEvent).where(WhatsAppMessageEvent.event_wa_id == "wamid.REACTION1")
                )
            ).scalar_one()
            reaction_rows = await session.scalar(
                select(text("count(*)")).select_from(WspMessage).where(WspMessage.message_type == "reaction")
            )
    assert event.provider_payload == reaction
    assert event.actor == "customer"
    assert reaction_rows == 0


@pytest.mark.asyncio
async def test_media_is_imported_without_touching_the_meta_object(tenant, fake_media) -> None:
    context, _phone, _ids = tenant
    await _deliver(tenant, inbound_webhook("document"))
    with tenant_context(context):
        row = await _message("wamid.DOCUMENT1")
    assert fake_media == ["1003383421387259"]
    assert row.media_url == "/media/1.bin"
    assert row.provider_payload == inbound_cases()["document"]["message"]
    assert row.content == "Mi receta"


@pytest.mark.asyncio
async def test_outbound_records_the_exact_body_sent_and_the_meta_status(tenant, monkeypatch) -> None:
    from app.modules.conversations import message_outbox
    from app.modules.leads.repository import create_lead
    from tests.conftest import FakeSender, install_channel

    context, _phone, _ids = tenant
    sender = FakeSender()
    install_channel(monkeypatch, sender=sender)
    monkeypatch.setattr(message_outbox, "manager", type("M", (), {"broadcast": staticmethod(_noop)})())

    with tenant_context(context):
        lead = await create_lead(phone="51987654321", name="Ana")
        [queued] = await message_outbox.enqueue_messages(lead["chat_id"], [{
            "content": "Hola Ana",
            "message": {"type": "text", "text": {"body": "Hola Ana"}},
        }], actor_user_id=None)
        assert queued["outbox_status"] == "queued"
        assert queued["provider_payload"] == {"type": "text", "text": {"body": "Hola Ana"}}

        jobs = await message_outbox._claim_batch()
        assert [job["message_id"] for job in jobs] == [queued["id"]]
        await message_outbox._process_job(jobs[0])

        async with get_sessionmaker()() as session:
            row = await session.get(WspMessage, queued["id"])
        assert row.outbox_status == "sent"
        assert row.wa_message_id == "WA-text"
        assert row.provider_payload == {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": "51900000000",
            "type": "text",
            "text": {"body": "Hola Ana"},
        }

    status = {**status_cases()["delivered"], "id": "WA-text"}
    await _deliver(tenant, _status_webhook(status))
    with tenant_context(context):
        assert (await _message("WA-text")).meta_status == "delivered"


async def _noop(*_args, **_kwargs):
    return None
