"""Dobles de prueba para los colaboradores externos del motor.

Permiten ejercitar la ejecución de acciones sin PostgreSQL ni Evolution API:
lo que antes obligaba a mandar WhatsApps reales para probar un cambio.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.automation_deps import AutomationDeps


@dataclass
class FakeWhatsApp:
    """Registra los envíos en vez de llamar a Evolution API."""

    texts: list[tuple[str, str]] = field(default_factory=list)
    media: list[tuple[str, str, str]] = field(default_factory=list)
    fail_with: Exception | None = None

    async def send_text(self, chat_id: str, text: str) -> dict:
        if self.fail_with:
            raise self.fail_with
        self.texts.append((chat_id, text))
        return {"key": {"id": f"WA{len(self.texts)}"}}

    async def send_media(self, chat_id: str, encoded: str, mediatype: str, filename: str | None = None) -> dict:
        if self.fail_with:
            raise self.fail_with
        self.media.append((chat_id, mediatype, filename or ""))
        return {"key": {"id": f"WAM{len(self.media)}"}}


@dataclass
class Recorder:
    """Acumula los efectos secundarios para poder afirmar sobre ellos."""

    messages: list[dict] = field(default_factory=list)
    tasks: list[dict] = field(default_factory=list)
    notifications: list[dict] = field(default_factory=list)
    broadcasts: list[dict] = field(default_factory=list)
    user_events: list[tuple[int, dict]] = field(default_factory=list)
    tags_added: list[tuple[str, int]] = field(default_factory=list)
    tags_removed: list[tuple[str, int]] = field(default_factory=list)
    stage_changes: list[tuple[str, str]] = field(default_factory=list)
    lead_updates: list[tuple[str, dict]] = field(default_factory=list)
    template_uses: list[int] = field(default_factory=list)


def make_rule(**overrides):
    defaults = {
        "id": 1,
        "name": "Regla de prueba",
        "created_by_user_id": 10,
        "conditions": {},
        "actions": [],
        "is_active": True,
        "max_executions_per_hour": None,
        "builder_mode": "simple",
        "flow_version": 0,
        "published_flow_definition": None,
    }
    return SimpleNamespace(**{**defaults, **overrides})


def make_execution(**overrides):
    defaults = {
        "id": 100,
        "rule_id": 1,
        "lead_id": "51999@s.whatsapp.net",
        "event_payload": {},
        "action_results": [],
        "flow_state": {},
        "status": "running",
        "attempts": 1,
    }
    return SimpleNamespace(**{**defaults, **overrides})


def make_chat(**overrides):
    defaults = {
        "chat_id": "51999@s.whatsapp.net",
        "name": "Ana",
        "phone": "51999",
        "stage": "nuevo",
        "origen": "Facebook",
        "servicio_interes": "Botox",
        "vendedor": "Luis",
        "vendedor_id": 7,
        "tags": [],
    }
    return {**defaults, **overrides}


@pytest.fixture
def recorder() -> Recorder:
    return Recorder()


@pytest.fixture
def whatsapp() -> FakeWhatsApp:
    return FakeWhatsApp()


@pytest.fixture
def frozen_now() -> datetime:
    return datetime(2026, 7, 20, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
def deps(recorder: Recorder, whatsapp: FakeWhatsApp, frozen_now: datetime) -> AutomationDeps:
    """Deps con la ventana de WhatsApp abierta por defecto; cada test la cierra
    o cambia lo que necesite con dataclasses.replace."""

    async def insert_message(chat_id, sender, content, media_url=None, wa_message_id=None, status=None):
        message = {
            "id": len(recorder.messages) + 1, "chat_id": chat_id, "sender": sender,
            "content": content, "media_url": media_url,
            "wa_message_id": wa_message_id, "status": status,
        }
        recorder.messages.append(message)
        return message

    async def create_task(values, user_id):
        task = {"id": len(recorder.tasks) + 1, **values, "created_by": user_id}
        recorder.tasks.append(task)
        return task

    async def create_notification(user_id, notification_type, title, body, lead_id=None, source_id=None, metadata=None):
        notification = {
            "id": len(recorder.notifications) + 1, "user_id": user_id,
            "type": notification_type, "title": title, "body": body,
        }
        recorder.notifications.append(notification)
        return notification

    async def assign_tag(chat_id, tag_id, user_id):
        recorder.tags_added.append((chat_id, tag_id))
        return True

    async def remove_tag(chat_id, tag_id, user_id):
        recorder.tags_removed.append((chat_id, tag_id))
        return True

    async def update_lead(chat_id, values, actor_type="system", actor_user_id=None):
        recorder.lead_updates.append((chat_id, values))
        return values

    async def update_lead_stage(chat_id, stage, actor_type="system", actor_user_id=None, metadata=None):
        # .value y no str(): LeadStage es (str, Enum) y no StrEnum, así que
        # str() devolvería "LeadStage.cierre" en vez de "cierre".
        value = getattr(stage, "value", stage)
        recorder.stage_changes.append((chat_id, value))
        return {"stage": value}

    async def record_template_use(template_id, user_id):
        recorder.template_uses.append(template_id)
        return True

    async def broadcast(payload):
        recorder.broadcasts.append(payload)

    async def send_to_user(user_id, payload):
        recorder.user_events.append((user_id, payload))

    async def open_window(chat_id):
        return {"is_open": True, "seconds_remaining": 3600}

    return AutomationDeps(
        now=lambda: frozen_now,
        insert_message=insert_message,
        create_task=create_task,
        create_notification=create_notification,
        assign_tag=assign_tag,
        remove_tag=remove_tag,
        update_lead=update_lead,
        update_lead_stage=update_lead_stage,
        record_template_use=record_template_use,
        broadcast=broadcast,
        send_to_user=send_to_user,
        get_customer_service_window=open_window,
        send_text=whatsapp.send_text,
        send_media=whatsapp.send_media,
        read_media_base64=lambda media_url: "ZmFrZS1iYXNlNjQ=",
    )
