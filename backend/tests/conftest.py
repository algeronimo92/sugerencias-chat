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
    """Registra las reacciones en vez de llamar a Evolution API. Los envíos
    de mensaje pasan por FakeOutbox (ver abajo), no por acá — el motor de
    automatizaciones los encola en vez de mandarlos directo."""

    reactions: list[tuple[dict, str]] = field(default_factory=list)
    fail_with: Exception | None = None

    async def send_reaction(self, key: dict, emoji: str) -> dict:
        if self.fail_with:
            raise self.fail_with
        self.reactions.append((key, emoji))
        return {"key": key}


@dataclass
class FakeOutbox:
    """Registra lo que el motor de automatizaciones intentó encolar, en vez
    de insertar de verdad en message_outbox — mismo espíritu que FakeWhatsApp,
    pero para deps.enqueue_messages."""

    enqueued: list[tuple[str, list[dict]]] = field(default_factory=list)
    fail_with: Exception | None = None

    async def enqueue_messages(self, chat_id: str, items: list[dict]) -> list[dict]:
        if self.fail_with:
            raise self.fail_with
        self.enqueued.append((chat_id, items))
        start = sum(len(sent_items) for _, sent_items in self.enqueued[:-1])
        return [
            {"id": start + position + 1, "chat_id": chat_id, "status": "PENDING", **item}
            for position, item in enumerate(items)
        ]


@dataclass
class Recorder:
    """Acumula los efectos secundarios para poder afirmar sobre ellos."""

    tasks: list[dict] = field(default_factory=list)
    notifications: list[dict] = field(default_factory=list)
    broadcasts: list[dict] = field(default_factory=list)
    user_events: list[tuple[int, dict]] = field(default_factory=list)
    tags_added: list[tuple[str, int]] = field(default_factory=list)
    tags_removed: list[tuple[str, int]] = field(default_factory=list)
    stage_changes: list[tuple[str, str]] = field(default_factory=list)
    lead_updates: list[tuple[str, dict]] = field(default_factory=list)
    template_uses: list[int] = field(default_factory=list)
    reactions: list[tuple[str, str, str, bool]] = field(default_factory=list)


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
def outbox() -> FakeOutbox:
    return FakeOutbox()


@pytest.fixture
def frozen_now() -> datetime:
    return datetime(2026, 7, 20, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
def deps(recorder: Recorder, whatsapp: FakeWhatsApp, outbox: FakeOutbox, frozen_now: datetime) -> AutomationDeps:
    """Deps con la ventana de WhatsApp abierta por defecto; cada test la cierra
    o cambia lo que necesite con dataclasses.replace."""

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
        # str() devolvería "LeadStage.en_objecion" en vez de "en_objecion".
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

    async def latest_customer_message(chat_id):
        return {"id": 42, "wa_message_id": "CLIENT-WA-42"}

    async def set_message_reaction(chat_id, wa_message_id, emoji, from_me):
        recorder.reactions.append((chat_id, wa_message_id, emoji, from_me))
        return {"id": 42, "wa_message_id": wa_message_id}

    return AutomationDeps(
        now=lambda: frozen_now,
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
        fetch_latest_customer_message_target=latest_customer_message,
        set_message_reaction=set_message_reaction,
        enqueue_messages=outbox.enqueue_messages,
        send_reaction=whatsapp.send_reaction,
    )
