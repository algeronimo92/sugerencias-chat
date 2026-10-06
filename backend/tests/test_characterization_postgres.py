"""Caracterización de los flujos núcleo contra PostgreSQL real.

Red de seguridad del refactor a arquitectura hexagonal: fija lo que el sistema
hace hoy, por las fronteras que el refactor no puede mover (HTTP, callbacks de
n8n y los contratos ``public.py``), sin mirar cómo está implementado. Si una
fase del refactor cambia un efecto observable —una fila, un campo, un aviso
por WebSocket—, alguno de estos tests lo tiene que notar.

Usa la app completa (``app.bootstrap.app``) con su cableado real de routers y
dependencias. Solo se sustituye la identidad: el usuario de la sesión y el
token compartido de n8n. El tenant se fija con ``tenant_context`` alrededor de
cada pedido, igual que lo haría el middleware con el host.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, insert, select, text

from app.bootstrap import app
from app.db.models.ai import AIJob
from app.db.models.appointments import Appointment
from app.db.models.auth import User
from app.db.models.automations import AutomationExecution, AutomationRule
from app.db.models.conversations import MessageOutbox, ScheduledMessage, WspMessage
from app.db.models.leads import Lead, LeadActivity
from app.db.models.notifications import UserNotification
from app.db.session import get_sessionmaker
from app.modules.ai.ai_context import make_context_revision
from app.modules.ai.ai_job_tokens import AIJobClaims, require_ai_job_context
from app.modules.auth.auth_service import get_current_user, verify_webhook_token
from app.modules.automations.application.engine import process_due_automation_executions
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.application.scheduling import dispatch_scheduled_message
from app.realtime.ws_manager import manager
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _create_user(role: str, name: str) -> User:
    async with get_sessionmaker()() as session:
        user = User(
            email=f"{name.lower()}-{secrets.token_hex(3)}@example.test",
            name=name,
            password_hash="!",
            role=role,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


class World:
    """Estado compartido de un escenario: tenant, usuarios, cliente HTTP y
    los avisos de tiempo real que se emitieron."""

    def __init__(self, tenant, seller: User, admin: User, client: httpx.AsyncClient):
        self.tenant = tenant
        self.seller = seller
        self.admin = admin
        self.client = client
        self.broadcasts: list[dict] = []
        self.user_events: list[tuple[int, dict]] = []
        self.acting_user = seller

    async def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        with tenant_context(self.tenant):
            return await self.client.request(method, url, **kwargs)

    async def create_lead(self, name: str = "Cliente Prueba") -> str:
        phone = "9" + "".join(secrets.choice("0123456789") for _ in range(8))
        response = await self.request("POST", "/api/chats", json={"phone": phone, "name": name})
        assert response.status_code == 201, response.text
        return response.json()["chat_id"]

    async def customer_says(self, chat_id: str, content: str) -> int:
        with tenant_context(self.tenant):
            async with get_sessionmaker()() as session:
                message_id = (await session.execute(
                    insert(WspMessage).values(
                        chat_id=chat_id, sender="cliente", content=content,
                        sent_at=datetime.now(timezone.utc), message_type="text",
                    ).returning(WspMessage.id)
                )).scalar_one()
                await session.commit()
                return message_id

    async def scalar(self, statement):
        with tenant_context(self.tenant):
            async with get_sessionmaker()() as session:
                return (await session.execute(statement)).scalar_one_or_none()

    async def rows(self, statement):
        with tenant_context(self.tenant):
            async with get_sessionmaker()() as session:
                return (await session.execute(statement)).scalars().all()

    def reasons(self, chat_id: str) -> list[str]:
        return [
            event.get("reason") for event in self.broadcasts
            if event.get("type") == "chats_updated" and event.get("chat_id") == chat_id
        ]


@pytest_asyncio.fixture
async def world(tenant, monkeypatch):
    with tenant_context(tenant):
        seller = await _create_user("vendedor", "Vendedora")
        admin = await _create_user("admin", "Administradora")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        state = World(tenant, seller, admin, client)

        async def broadcast(message: dict, **_kwargs) -> None:
            state.broadcasts.append(message)

        async def send_to_user(user_id: int, message: dict, **_kwargs) -> None:
            state.user_events.append((user_id, message))

        monkeypatch.setattr(manager, "broadcast", broadcast)
        monkeypatch.setattr(manager, "send_to_user", send_to_user)
        app.dependency_overrides[get_current_user] = lambda: state.acting_user
        app.dependency_overrides[verify_webhook_token] = lambda: None
        try:
            yield state
        finally:
            app.dependency_overrides.clear()


async def _stage_activities(world: World, chat_id: str) -> list[LeadActivity]:
    return await world.rows(
        select(LeadActivity)
        .where(LeadActivity.lead_id == chat_id, LeadActivity.event_type == "stage_changed")
        .order_by(LeadActivity.id)
    )


async def _stage_rule(world: World, name: str, actions: list[dict]) -> int:
    now = datetime.now(timezone.utc)
    with tenant_context(world.tenant):
        async with get_sessionmaker()() as session:
            rule_id = (await session.execute(
                insert(AutomationRule).values(
                    name=name, trigger_type="stage_changed", trigger_config={},
                    conditions={}, actions=actions, delay_minutes=0,
                    created_by_user_id=world.admin.id, created_at=now, updated_at=now,
                ).returning(AutomationRule.id)
            )).scalar_one()
            await session.commit()
            return rule_id


# --- Cambio de etapa: los cuatro caminos ---------------------------------


async def test_user_moves_a_lead_from_the_kanban(world: World) -> None:
    chat_id = await world.create_lead()
    await world.customer_says(chat_id, "Ya no me interesa, gracias")
    rule_id = await _stage_rule(world, "Aviso de etapa", [])

    response = await world.request(
        "PATCH", f"/api/chats/{chat_id}/stage",
        json={"stage": "perdido", "razon_perdido": "Precio"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["stage"] == "perdido"
    assert body["razon_perdido"] == "Precio"
    [activity] = await _stage_activities(world, chat_id)
    assert (activity.actor_type, activity.actor_user_id) == ("user", world.seller.id)
    assert activity.old_value == {"stage": "nuevo"}
    assert activity.new_value == {"stage": "perdido"}
    assert activity.metadata_["reason"] == "Precio"
    assert activity.metadata_["trigger_message"]["content"] == "Ya no me interesa, gracias"
    executions = await world.rows(
        select(AutomationExecution).where(AutomationExecution.lead_id == chat_id)
    )
    assert [(e.rule_id, e.trigger_type, e.status) for e in executions] == [
        (rule_id, "stage_changed", "scheduled"),
    ]
    assert "stage_changed" in world.reasons(chat_id)

    # Salir de una etapa `lost` limpia la razón.
    response = await world.request("PATCH", f"/api/chats/{chat_id}/stage", json={"stage": "calificado"})
    assert response.status_code == 200, response.text
    assert response.json()["razon_perdido"] is None


async def test_an_unknown_or_inactive_stage_is_rejected(world: World) -> None:
    chat_id = await world.create_lead()

    response = await world.request("PATCH", f"/api/chats/{chat_id}/stage", json={"stage": "inventada"})

    assert response.status_code in (400, 422), response.text
    assert "detail" in response.json()
    assert await _stage_activities(world, chat_id) == []


async def test_n8n_analyst_moves_a_lead_through_the_webhook(world: World) -> None:
    chat_id = await world.create_lead()
    await world.customer_says(chat_id, "Quiero agendar")

    response = await world.request(
        "POST", "/api/webhooks/lead-stage",
        json={"chat_id": chat_id, "estado": "calificado", "razonamiento": "Pidió turno"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ok", "changed": True, "stage": "calificado"}
    [activity] = await _stage_activities(world, chat_id)
    assert (activity.actor_type, activity.actor_user_id) == ("agent", None)
    assert activity.metadata_["reason"] == "Pidió turno"
    assert activity.metadata_["trigger_message"]["content"] == "Quiero agendar"
    assert await world.scalar(select(Lead.estado).where(Lead.id == chat_id)) == "calificado"
    assert "stage_changed" in world.reasons(chat_id)


async def test_an_automation_moves_a_lead_without_retriggering_itself(world: World) -> None:
    chat_id = await world.create_lead()
    rule_id = await _stage_rule(
        world, "Califica al diagnosticar", [{"type": "change_stage", "stage": "calificado"}],
    )
    response = await world.request("PATCH", f"/api/chats/{chat_id}/stage", json={"stage": "en_diagnostico"})
    assert response.status_code == 200, response.text

    with tenant_context(world.tenant):
        processed = await process_due_automation_executions()

    assert processed >= 1
    assert await world.scalar(select(Lead.estado).where(Lead.id == chat_id)) == "calificado"
    activities = await _stage_activities(world, chat_id)
    assert [a.new_value["stage"] for a in activities] == ["en_diagnostico", "calificado"]
    assert activities[1].metadata_["automation_rule_id"] == rule_id
    # El cambio hecho por la automatización no agenda otra ejecución.
    executions = await world.rows(
        select(AutomationExecution).where(AutomationExecution.lead_id == chat_id)
    )
    assert [e.status for e in executions] == ["completed"]


async def test_ai_analysis_job_applies_fields_and_stage_atomically(world: World) -> None:
    chat_id = await world.create_lead()
    message_id = await world.customer_says(chat_id, "Me interesa el tratamiento")
    updated_at = await world.scalar(select(Lead.updated_at).where(Lead.id == chat_id))
    revision = make_context_revision(updated_at, message_id)
    job_id = str(uuid4())
    now = datetime.now(timezone.utc)
    with tenant_context(world.tenant):
        async with get_sessionmaker()() as session:
            session.add(AIJob(
                id=job_id, operation="analyst", resource_id=chat_id, chat_id=chat_id,
                context_revision=revision, status="running", created_at=now,
                expires_at=now + timedelta(minutes=5),
                request_metadata={"completed_steps": ["context_loaded"]},
            ))
            await session.commit()
    app.dependency_overrides[require_ai_job_context] = lambda: AIJobClaims(
        organization_id=world.tenant.organization_id, job_id=job_id,
        operation="analyst", expires_at=now + timedelta(minutes=5),
    )

    response = await world.request(
        "POST", f"/api/webhooks/analysis-jobs/{job_id}/apply",
        headers={"X-Job-Id": job_id},
        json={
            "chat_id": chat_id, "context_revision": revision,
            "fields": {"notas": "Interesada en el tratamiento"},
            "estado": "perdido", "razonamiento": "No tiene presupuesto",
        },
    )

    assert response.status_code == 200, response.text
    lead = await world.scalar(select(Lead).where(Lead.id == chat_id))
    assert (lead.estado, lead.razon_perdido, lead.notas) == (
        "perdido", "No tiene presupuesto", "Interesada en el tratamiento",
    )
    [activity] = await _stage_activities(world, chat_id)
    assert activity.actor_type == "agent"
    assert activity.metadata_["job_id"] == job_id
    assert activity.metadata_["trigger_message"]["content"] == "Me interesa el tratamiento"
    assert await world.scalar(select(AIJob.status).where(AIJob.id == job_id)) == "applied"


# --- Envío de mensajes ----------------------------------------------------


async def test_a_seller_message_goes_through_the_outbox(world: World) -> None:
    chat_id = await world.create_lead()
    await world.customer_says(chat_id, "Hola")

    response = await world.request("POST", f"/api/chats/{chat_id}/messages", json={"text": "Hola, ¿cómo te ayudo?"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sender"] == "vendedor"
    assert body["content"] == "Hola, ¿cómo te ayudo?"
    message = await world.scalar(select(WspMessage).where(WspMessage.id == body["id"]))
    assert message.outbox_status == "queued"
    assert message.sent_by_user_id == world.seller.id
    job = await world.scalar(select(MessageOutbox).where(MessageOutbox.message_id == body["id"]))
    assert job.status == "pending"
    assert job.payload["actor_user_id"] == world.seller.id
    assert job.payload["message"]["type"] == "text"
    # Un envío del vendedor cuenta como que un humano vio la conversación.
    assert await world.scalar(select(Lead.last_read_at).where(Lead.id == chat_id)) is not None
    assert "outbound_queued" in world.reasons(chat_id)


async def test_sending_with_the_service_window_closed_is_rejected(world: World) -> None:
    chat_id = await world.create_lead()

    response = await world.request("POST", f"/api/chats/{chat_id}/messages", json={"text": "Hola"})

    assert response.status_code == 409, response.text
    count = await world.scalar(select(func.count(WspMessage.id)).where(WspMessage.chat_id == chat_id))
    assert count == 0


# --- Citas ----------------------------------------------------------------


async def test_an_appointment_is_recorded_linked_and_announced(world: World) -> None:
    chat_id = await world.create_lead("Paciente Cita")
    phone = await world.scalar(select(Lead.telefono).where(Lead.id == chat_id))

    response = await world.request("POST", "/api/appointments", json={
        "nombre_completo": "Paciente Cita", "telefono": phone, "tratamiento": "Limpieza",
        "fecha": (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat(),
        "hora": "10:00", "vendedor": "Vendedora",
    })

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    appointment = await world.scalar(select(Appointment).where(Appointment.id == body["appointment"]["id"]))
    assert appointment.created_by_user_id == world.seller.id
    assert appointment.lead_id == chat_id
    assert appointment.status == "created"
    assert appointment.calendar_sync_status == "not_configured"
    recipients = set(await world.rows(
        select(UserNotification.user_id).where(UserNotification.source_id == str(appointment.id))
    ))
    assert recipients == {world.seller.id, world.admin.id}


# --- Alta de lead y etiquetas ---------------------------------------------


async def test_creating_a_lead_is_audited_and_triggers_automations(world: World) -> None:
    now = datetime.now(timezone.utc)
    with tenant_context(world.tenant):
        async with get_sessionmaker()() as session:
            rule_id = (await session.execute(
                insert(AutomationRule).values(
                    name="Bienvenida", trigger_type="lead_created", trigger_config={},
                    conditions={}, actions=[], delay_minutes=0,
                    created_by_user_id=world.admin.id, created_at=now, updated_at=now,
                ).returning(AutomationRule.id)
            )).scalar_one()
            await session.commit()

    chat_id = await world.create_lead("Nueva Clienta")

    lead = await world.scalar(select(Lead).where(Lead.id == chat_id))
    assert (lead.nombre, lead.estado) == ("Nueva Clienta", "nuevo")
    created = await world.rows(
        select(LeadActivity).where(LeadActivity.lead_id == chat_id, LeadActivity.event_type == "lead_created")
    )
    assert [(a.actor_type, a.actor_user_id) for a in created] == [("user", world.seller.id)]
    executions = await world.rows(
        select(AutomationExecution).where(AutomationExecution.lead_id == chat_id)
    )
    assert [(e.rule_id, e.trigger_type) for e in executions] == [(rule_id, "lead_created")]
    assert "lead_created" in world.reasons(chat_id)

    duplicate = await world.request(
        "POST", "/api/chats", json={"phone": lead.telefono, "name": "Otra"},
    )
    assert duplicate.status_code == 409


async def test_tags_are_assigned_and_removed_with_audit(world: World) -> None:
    chat_id = await world.create_lead()
    world.acting_user = world.admin
    created = await world.request("POST", "/api/tags", json={"name": "VIP", "color": "#16a34a"})
    assert created.status_code == 201, created.text
    tag_id = created.json()["id"]
    world.acting_user = world.seller

    added = await world.request("POST", f"/api/chats/{chat_id}/tags/{tag_id}")
    assert added.status_code == 200, added.text
    assert [tag["id"] for tag in added.json()["tags"]] == [tag_id]

    removed = await world.request("DELETE", f"/api/chats/{chat_id}/tags/{tag_id}")
    assert removed.status_code == 200, removed.text
    assert removed.json()["tags"] == []

    events = await world.rows(
        select(LeadActivity.event_type)
        .where(LeadActivity.lead_id == chat_id, LeadActivity.event_type.in_(("tag_added", "tag_removed")))
        .order_by(LeadActivity.id)
    )
    assert events == ["tag_added", "tag_removed"]
    assert world.reasons(chat_id).count("tag_changed") == 2
    missing = await world.request("DELETE", f"/api/chats/{chat_id}/tags/{tag_id}")
    assert missing.status_code == 404


# --- Mensajes programados -------------------------------------------------


async def test_a_scheduled_message_is_queued_and_credited_to_its_author(world: World) -> None:
    chat_id = await world.create_lead()
    await world.customer_says(chat_id, "Escribime mañana")
    scheduled_at = datetime.now(timezone.utc) + timedelta(hours=2)

    created = await world.request(
        "POST", f"/api/chats/{chat_id}/scheduled-messages",
        json={"text": "Hola, te escribo como quedamos", "scheduled_at": scheduled_at.isoformat()},
    )
    assert created.status_code == 201, created.text
    scheduled_id = created.json()["id"]

    # Llega su hora: el worker lo reclama y lo encola por la outbox.
    with tenant_context(world.tenant):
        async with get_sessionmaker()() as session:
            await session.execute(
                text("UPDATE scheduled_messages SET scheduled_at = now() - interval '1 minute' WHERE id = :id"),
                {"id": scheduled_id},
            )
            await session.commit()
        claimed = await conversation_ports().scheduled.claim_due()
        assert scheduled_id in claimed
        await dispatch_scheduled_message(scheduled_id)

    row = await world.scalar(select(ScheduledMessage).where(ScheduledMessage.id == scheduled_id))
    assert row.status == "queued"
    message = await world.scalar(select(WspMessage).where(WspMessage.id == row.queued_message_id))
    assert (message.content, message.sender) == ("Hola, te escribo como quedamos", "vendedor")
    assert message.sent_by_user_id == world.seller.id
    job = await world.scalar(select(MessageOutbox).where(MessageOutbox.message_id == message.id))
    assert job.dedupe_key == f"scheduled:{scheduled_id}"
    # Nadie miraba la app cuando salió: cuenta como atendido por bot.
    assert job.payload["actor_user_id"] is None


# --- Contrato de las respuestas -------------------------------------------


async def test_the_dashboard_contract_keeps_everything_the_metrics_compute(world: World) -> None:
    """El response_model del dashboard no descarta nada: lo que calcula cada
    bloque, con datos reales en cada lista, pasa por el modelo sin perderse."""
    from fastapi.encoders import jsonable_encoder

    from app.modules.leads.dashboard.queries import _compute
    from app.modules.leads.dashboard.scope import build_scope
    from app.modules.leads.schemas import DashboardMetrics

    chat_id = await world.create_lead("Paciente Panel")
    await world.customer_says(chat_id, "Hola, ¿precio?")
    await _stage_rule(world, "Panel", [])
    moved = await world.request("PATCH", f"/api/chats/{chat_id}/stage", json={"stage": "calificado"})
    assert moved.status_code == 200, moved.text
    world.acting_user = world.admin
    tag = await world.request("POST", "/api/tags", json={"name": "Panel", "color": "#16a34a"})
    assert (await world.request("POST", f"/api/chats/{chat_id}/tags/{tag.json()['id']}")).status_code == 200
    phone = await world.scalar(select(Lead.telefono).where(Lead.id == chat_id))
    appointment = await world.request("POST", "/api/appointments", json={
        "nombre_completo": "Paciente Panel", "telefono": phone, "tratamiento": "Limpieza",
        "fecha": (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat(),
        "hora": "10:00", "vendedor": "Vendedora",
    })
    assert appointment.status_code == 200, appointment.text

    with tenant_context(world.tenant):
        payload = await _compute(build_scope(30, "team", world.admin.id))

    assert payload["stages"] and payload["automations"]["by_flow"] and payload["appointments"]["upcoming"]
    assert DashboardMetrics.model_validate(payload).model_dump(mode="json") == jsonable_encoder(payload)
    response = await world.request("GET", "/api/dashboard", params={"days": 30, "scope": "team"})
    assert response.status_code == 200, response.text


async def test_the_organization_list_contract_keeps_every_field(world: World) -> None:
    from fastapi.encoders import jsonable_encoder

    from app.modules.platform.platform_organizations import list_organizations
    from app.modules.platform.schemas import OrganizationList

    payload = await list_organizations()

    assert payload["items"] and payload["items"][0]["domains"]
    assert OrganizationList.model_validate(payload).model_dump(mode="json") == jsonable_encoder(payload)
