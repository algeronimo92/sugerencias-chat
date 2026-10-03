import contextlib
"""Dobles de prueba para los colaboradores externos del motor.

Permiten ejercitar la ejecución de acciones sin PostgreSQL ni Meta: lo que
antes obligaba a mandar WhatsApps reales para probar un cambio.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.composition import configure as configure_composition
from tests.leads_fakes import in_memory_leads  # noqa: F401  (fixture compartido)
from tests.conversation_fakes import in_memory_conversations  # noqa: F401  (fixture compartido)
from tests.automation_fakes import InMemoryExecutionStore, in_memory_automations  # noqa: F401  (fixture compartido)

from app.modules.automations.application.deps import AutomationDeps


@dataclass
class FakeWhatsApp:
    """Registra las reacciones en vez de mandarlas a Meta. Los envíos de
    mensaje pasan por FakeOutbox (ver abajo), no por acá — el motor de
    automatizaciones los encola en vez de mandarlos directo."""

    reactions: list[tuple[str, str, str]] = field(default_factory=list)
    fail_with: Exception | None = None

    async def send_reaction(self, chat_id: str, target_wa_message_id: str, emoji: str) -> dict:
        if self.fail_with:
            raise self.fail_with
        self.reactions.append((chat_id, target_wa_message_id, emoji))
        return {"id": 1, "wa_message_id": target_wa_message_id, "reactions": [{"emoji": emoji, "from_me": True}]}


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
            {"id": start + position + 1, "chat_id": chat_id, "outbox_status": "queued", **item}
            for position, item in enumerate(items)
        ]


@dataclass
class Recorder:
    """Acumula los efectos secundarios para poder afirmar sobre ellos."""

    tasks: list[dict] = field(default_factory=list)
    notifications: list[dict] = field(default_factory=list)
    # Los eventos que publicó el motor (los avisos salen de sus suscriptores).
    events: list = field(default_factory=list)
    tags_added: list[tuple[str, int]] = field(default_factory=list)
    tags_removed: list[tuple[str, int]] = field(default_factory=list)
    stage_changes: list[tuple[str, str]] = field(default_factory=list)
    lead_updates: list[tuple[str, dict]] = field(default_factory=list)
    template_uses: list[int] = field(default_factory=list)
    reactions: list[tuple[str, str, str, bool]] = field(default_factory=list)

    def of(self, event_type) -> list:
        return [event for event in self.events if isinstance(event, event_type)]


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
        "lead_id": "4316bc30-f78c-57a2-8f98-bff9087678d6",
        "event_payload": {},
        "action_results": [],
        "flow_state": {},
        "status": "running",
        "attempts": 1,
        "started_by_user_id": None,
        # Sin autorización del admin para saltarse la ventana de 24 h: es lo
        # que trae cualquier ejecución que no vino de un reintento forzado.
        "window_override_by_user_id": None,
    }
    return SimpleNamespace(**{**defaults, **overrides})


def make_chat(**overrides):
    defaults = {
        "chat_id": "4316bc30-f78c-57a2-8f98-bff9087678d6",
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
def executions() -> InMemoryExecutionStore:
    return InMemoryExecutionStore()


@pytest.fixture
def deps(
    recorder: Recorder, whatsapp: FakeWhatsApp, outbox: FakeOutbox, frozen_now: datetime,
    executions: InMemoryExecutionStore,
) -> AutomationDeps:
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

    async def change_stage(chat_id, stage, actor_type="system", actor_user_id=None, metadata=None):
        # La etapa es la clave de texto del negocio (lead_stages.key).
        recorder.stage_changes.append((chat_id, stage))
        return {"stage": stage}

    async def record_template_use(template_id, user_id):
        recorder.template_uses.append(template_id)
        return True

    async def publish(*events):
        recorder.events.extend(events)

    async def nothing(*_args):
        return None

    async def open_window(chat_id):
        return {"is_open": True, "seconds_remaining": 3600}

    async def latest_customer_message(chat_id):
        return {"id": 42, "wa_message_id": "CLIENT-WA-42"}

    async def set_message_reaction(chat_id, wa_message_id, emoji, from_me):
        recorder.reactions.append((chat_id, wa_message_id, emoji, from_me))
        return {"id": 42, "wa_message_id": wa_message_id}

    return AutomationDeps(
        executions=executions,
        now=lambda: frozen_now,
        publish=publish,
        fetch_chat=nothing,
        fetch_lead=nothing,
        latest_message=nothing,
        latest_outbound_media_wa_id=nothing,
        load_template=nothing,
        load_media_asset=nothing,
        create_task=create_task,
        create_notification=create_notification,
        assign_tag=assign_tag,
        remove_tag=remove_tag,
        update_lead=update_lead,
        change_stage=change_stage,
        record_template_use=record_template_use,
        get_customer_service_window=open_window,
        fetch_latest_customer_message_target=latest_customer_message,
        enqueue_messages=outbox.enqueue_messages,
        send_reaction=whatsapp.send_reaction,
    )


class FakeSender:
    """Canal saliente que registra cada cuerpo de Meta y devuelve un recibo."""

    def __init__(self, fail_with: Exception | None = None, media_id: str = "MEDIA-1"):
        self.calls: list[tuple[str, dict]] = []
        self.uploads: list[tuple[bytes, str, str]] = []
        self.fail_with = fail_with
        self.media_id = media_id

    async def upload_media(self, content: bytes, content_type: str, filename: str) -> str:
        self.uploads.append((content, content_type, filename))
        return self.media_id

    async def send(self, chat_id: str, message: dict):
        from app.integrations.whatsapp.channel import SendReceipt

        self.calls.append((chat_id, message))
        if self.fail_with:
            raise self.fail_with
        body = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": "51900000000", **message}
        return SendReceipt(provider_message_id=f"WA-{message.get('type')}", sent_body=body)

    def only_call(self) -> tuple[str, dict]:
        assert len(self.calls) == 1, self.calls
        return self.calls[0]


@dataclass
class FakeConversationActions:
    reads: list = field(default_factory=list)
    fail_with: Exception | None = None

    async def mark_read(self, chat_id, provider_message_ids):
        if self.fail_with:
            raise self.fail_with
        self.reads.append((chat_id, provider_message_ids))


@dataclass
class FakeChannelStatus:
    """Canal configurado salvo que el test diga lo contrario."""

    integration: str | None = "FAKE-CHANNEL"
    configured: bool = True
    reason: str | None = None

    async def availability(self):
        from app.integrations.whatsapp.channel import ChannelAvailability

        return ChannelAvailability(
            integration=self.integration if self.configured else None,
            configured=self.configured,
            reason=self.reason,
        )


def install_channel(monkeypatch, **components):
    from app.integrations.whatsapp import channels as whatsapp_channels
    from app.integrations.whatsapp.channel import WhatsAppChannel

    channel = WhatsAppChannel(
        name="meta",
        sender=components.get("sender") or FakeSender(),
        actions=components.get("actions") or FakeConversationActions(),
        status=components.get("status") or FakeChannelStatus(),
    )
    monkeypatch.setitem(whatsapp_channels.CHANNELS, whatsapp_channels.ACTIVE_CHANNEL, channel)
    return channel


def _package_modules(facade_name: str, package_name: str):
    import importlib
    import pkgutil

    package = importlib.import_module(package_name)
    return [importlib.import_module(facade_name)] + [
        importlib.import_module(f"{package_name}.{info.name}") for info in pkgutil.iter_modules(package.__path__)
    ]


def _patch_everywhere(monkeypatch, modules, name, value):
    bound = [module for module in modules if hasattr(module, name)]
    assert bound, f"ningún módulo define {name}"
    for module in bound:
        monkeypatch.setattr(module, name, value)


def _package_tree(package_name: str):
    import importlib
    import pkgutil

    package = importlib.import_module(package_name)
    return [package] + [
        importlib.import_module(info.name)
        for info in pkgutil.walk_packages(package.__path__, prefix=f"{package_name}.")
    ]


def patch_session_scope(monkeypatch, module, sessionmaker):
    """Hace que ``module.session_scope`` entregue la sesión falsa que abre
    ``sessionmaker()()``. Las sesiones falsas viejas tenían ``commit``; con la
    unidad de trabajo los repositorios hacen ``flush`` y el scope confirma."""
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session_scope():
        async with sessionmaker()() as session:
            if not hasattr(session, "flush"):
                async def flush():
                    return None
                session.flush = flush
            yield session

    monkeypatch.setattr(module, "session_scope", session_scope)


def patch_automations(monkeypatch, name, value):
    """Reemplaza un colaborador en todos los módulos del motor de automatizaciones que lo usan."""
    _patch_everywhere(monkeypatch, _package_tree("app.modules.automations"), name, value)


def patch_store(monkeypatch, name, value):
    """Reemplaza un colaborador en todos los módulos de persistencia que lo usan."""
    modules = []
    for package in ("conversations", "leads", "catalogs", "tasks", "auth", "ai", "appointments", "platform"):
        facade = f"app.modules.{package}.public" if package in {"auth", "ai", "platform"} else f"app.modules.{package}"
        modules.extend(_package_modules(facade, f"app.modules.{package}"))
    _patch_everywhere(monkeypatch, modules, name, value)


def patch_chats(monkeypatch, name, value):
    """Reemplaza un colaborador en todos los módulos del router de chats que lo usan."""
    modules = _package_modules("app.modules.conversations.api", "app.modules.conversations")
    modules.extend(_package_modules("app.modules.leads.api", "app.modules.leads"))
    _patch_everywhere(monkeypatch, modules, name, value)


def open_service_window(monkeypatch, is_open: bool = True):
    """Ventana de atención de 24 h abierta para las rutas de envío libre.

    Los tests de envío simulan el lead, la outbox y el canal; la ventana es el
    otro chequeo previo que hacen todas esas rutas.
    """
    from unittest.mock import AsyncMock

    patch_chats(monkeypatch, "service_window_is_open", AsyncMock(return_value=is_open))


def patch_webhooks(monkeypatch, name, value):
    """Reemplaza un colaborador en todos los módulos del router de webhooks que lo usan."""
    _patch_everywhere(monkeypatch, _package_modules("app.integrations.n8n.api", "app.integrations.n8n"), name, value)


@contextlib.contextmanager
def _patching(patcher_function, name, new):
    from unittest.mock import MagicMock

    replacement = MagicMock() if new is None else new
    patcher = pytest.MonkeyPatch()
    try:
        patcher_function(patcher, name, replacement)
        yield replacement
    finally:
        patcher.undo()


def automations_patch(name, new=None):
    return _patching(patch_automations, name, new)


def store_patch(name, new=None):
    return _patching(patch_store, name, new)


@pytest.fixture
def collected_events(monkeypatch) -> list:
    """Unidad de trabajo sin base: los comandos corren contra repositorios
    falsos y se registra lo que cada uno anunció."""
    from contextlib import asynccontextmanager

    from app.db import uow

    class _Session:
        @asynccontextmanager
        async def begin(self):
            yield self

        async def close(self):
            return None

    events: list = []

    async def record(pending):
        events.extend(pending)

    async def nothing(_events):
        return None

    monkeypatch.setattr(uow, "get_sessionmaker", lambda: _Session)
    monkeypatch.setattr(uow, "dispatch_in_transaction", record)
    monkeypatch.setattr(uow, "dispatch_after_commit", nothing)
    return events


# Los adaptadores y suscriptores reales, igual que en la API y los workers.
configure_composition()
