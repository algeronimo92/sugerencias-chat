"""Autorización del admin para enviar con la ventana de 24 h cerrada.

Una automatización que le escribe a un lead que hace más de un día no responde
queda en `failed` y avisa al admin. Ese aviso era terminal: reintentar volvía a
chocar contra el mismo guard. Acá se cubre el permiso puntual — el admin lo da
sobre una ejecución concreta, queda registrado quién fue, y no se hereda.
"""

import dataclasses
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from domain_types import AutomationActionType, AutomationExecutionStatus, NotificationType
from services import automation_service
from services.automation_service import (
    SERVICE_WINDOW_CLOSED_ERROR,
    SERVICE_WINDOW_ERROR_CODE,
    _execute_action,
    _notify_execution_failure,
)
from tests.conftest import make_chat, make_execution, make_rule
from tests.test_automation_actions import deps_with_template, template


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


def _compile(statement) -> str:
    return str(statement.compile(
        dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True},
    ))


async def _closed_window(_chat_id):
    return {"is_open": False, "seconds_remaining": 0}


class TestGuard:
    async def test_la_ventana_cerrada_frena_el_envio(self, deps, outbox):
        closed = dataclasses.replace(
            deps_with_template(deps, template()), get_customer_service_window=_closed_window,
        )
        with pytest.raises(ValueError, match="ventana de 24 horas"):
            await _execute_action(
                {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5},
                make_chat(), make_execution(), make_rule(), closed,
            )
        assert outbox.enqueued == []

    async def test_la_ejecucion_autorizada_envia_igual(self, deps, outbox):
        closed = dataclasses.replace(
            deps_with_template(deps, template()), get_customer_service_window=_closed_window,
        )
        result = await _execute_action(
            {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5},
            make_chat(),
            make_execution(window_override_by_user_id=3),
            make_rule(),
            closed,
        )
        assert result["message_ids"] == [1]
        assert outbox.enqueued == [(
            "51999@s.whatsapp.net",
            [{"content": "Hola Ana", "payload": {"type": "text", "text": "Hola Ana"}}],
        )]

    async def test_la_autorizacion_no_alcanza_a_otra_ejecucion(self, deps, outbox):
        """El permiso vive en la ejecución: otra de la misma regla no lo hereda."""
        closed = dataclasses.replace(
            deps_with_template(deps, template()), get_customer_service_window=_closed_window,
        )
        with pytest.raises(ValueError, match="ventana de 24 horas"):
            await _execute_action(
                {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5},
                make_chat(), make_execution(id=101), make_rule(), closed,
            )
        assert outbox.enqueued == []


class TestRetry:
    def _session(self):
        session = AsyncMock()
        session.get = AsyncMock(side_effect=[
            SimpleNamespace(id=5, status=AutomationExecutionStatus.FAILED, rule_id=1, attempts=6),
            SimpleNamespace(id=1, deleted_at=None, is_active=True),
        ])
        session.execute = AsyncMock(return_value=SimpleNamespace(rowcount=1))
        return session

    def _patch(self, monkeypatch, session):
        monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))
        monkeypatch.setattr(automation_service, "manager", SimpleNamespace(broadcast=AsyncMock()))
        monkeypatch.setattr(
            automation_service, "get_automation_execution", AsyncMock(return_value={"id": 5}),
        )

    async def test_registra_quien_autorizo(self, monkeypatch):
        session = self._session()
        self._patch(monkeypatch, session)

        await automation_service.retry_automation_execution(
            5, ignore_service_window=True, actor_user_id=7,
        )

        update_sql = _compile(session.execute.await_args.args[0])
        assert "window_override_by_user_id=7" in update_sql
        assert "window_override_at=" in update_sql

    async def test_el_reintento_comun_limpia_la_autorizacion(self, monkeypatch):
        """Un reintento sin autorización explícita no arrastra una anterior."""
        session = self._session()
        self._patch(monkeypatch, session)

        await automation_service.retry_automation_execution(5, actor_user_id=7)

        update_sql = _compile(session.execute.await_args.args[0])
        assert "window_override_by_user_id=NULL" in update_sql
        assert "window_override_at=NULL" in update_sql


class TestNotification:
    async def _notify(self, error: str) -> dict:
        created: dict = {}

        async def create_notification(user_id, notification_type, title, body, lead_id, source_id, metadata):
            created.update(metadata=metadata, title=title, body=body, type=notification_type)
            return {"id": 1}

        deps = SimpleNamespace(create_notification=create_notification, send_to_user=AsyncMock())
        await _notify_execution_failure(
            make_rule(name="Hollywood peel"),
            make_execution(),
            error,
            deps,
        )
        return created

    async def test_la_alerta_de_ventana_cerrada_lleva_el_codigo(self):
        created = await self._notify(SERVICE_WINDOW_CLOSED_ERROR)
        assert created["type"] == NotificationType.AUTOMATION
        assert created["metadata"]["error_code"] == SERVICE_WINDOW_ERROR_CODE
        assert created["metadata"]["automation_execution_id"] == 100

    async def test_otro_fallo_no_ofrece_la_autorizacion(self):
        created = await self._notify("La plantilla no tiene contenido para enviar")
        assert "error_code" not in created["metadata"]
