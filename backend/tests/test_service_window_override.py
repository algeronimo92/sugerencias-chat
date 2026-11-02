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

from app.modules.automations.ports.types import AutomationActionType, AutomationExecutionStatus
from app.modules.notifications.ports.types import NotificationType
from app.modules.automations import subscribers
from app.modules.automations.application.actions import execute_action
from app.modules.automations.application.management import retry_automation_execution
from app.modules.automations.domain.errors import StepFailed
from app.modules.automations.domain.events import AutomationsChanged, ExecutionFailed
from app.modules.automations.domain.types import ExecutionErrorCode
from app.modules.conversations.service_window import SERVICE_WINDOW_CLOSED_ERROR, SERVICE_WINDOW_ERROR_CODE
from tests.automation_fakes import execution as stored_execution, rule as stored_rule
from tests.conftest import make_chat, make_execution, make_rule
from tests.test_automation_actions import deps_with_template, template


async def _closed_window(_chat_id):
    return {"is_open": False, "seconds_remaining": 0}


class TestGuard:
    async def test_la_ventana_cerrada_frena_el_envio(self, deps, outbox):
        closed = dataclasses.replace(
            deps_with_template(deps, template()), get_customer_service_window=_closed_window,
        )
        with pytest.raises(StepFailed, match="ventana de 24 horas") as raised:
            await execute_action(
                {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5},
                make_chat(), make_execution(), make_rule(), closed,
            )
        assert raised.value.execution_error == ExecutionErrorCode.SERVICE_WINDOW_CLOSED
        assert outbox.enqueued == []

    async def test_la_ejecucion_autorizada_envia_igual(self, deps, outbox):
        closed = dataclasses.replace(
            deps_with_template(deps, template()), get_customer_service_window=_closed_window,
        )
        result = await execute_action(
            {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5},
            make_chat(),
            make_execution(window_override_by_user_id=3),
            make_rule(),
            closed,
        )
        assert result["message_ids"] == [1]
        assert outbox.enqueued == [(
            "4316bc30-f78c-57a2-8f98-bff9087678d6",
            [{"content": "Hola Ana", "message": {"type": "text", "text": {"body": "Hola Ana"}}}],
        )]

    async def test_la_autorizacion_no_alcanza_a_otra_ejecucion(self, deps, outbox):
        """El permiso vive en la ejecución: otra de la misma regla no lo hereda."""
        closed = dataclasses.replace(
            deps_with_template(deps, template()), get_customer_service_window=_closed_window,
        )
        with pytest.raises(ValueError, match="ventana de 24 horas"):
            await execute_action(
                {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5},
                make_chat(), make_execution(id=101), make_rule(), closed,
            )
        assert outbox.enqueued == []


class TestRetry:
    @pytest.fixture
    def failed(self, in_memory_automations):
        in_memory_automations.executions.add(
            stored_execution(id=5, status=AutomationExecutionStatus.FAILED, window_override_by_user_id=3),
            stored_rule(),
        )
        return in_memory_automations

    async def test_registra_quien_autorizo(self, failed):
        await retry_automation_execution(5, ignore_service_window=True, actor_user_id=7)

        assert failed.executions.executions[5].window_override_by_user_id == 7
        assert failed.of(AutomationsChanged) == [AutomationsChanged(wake=True)]

    async def test_el_reintento_comun_limpia_la_autorizacion(self, failed):
        """Un reintento sin autorización explícita no arrastra una anterior."""
        await retry_automation_execution(5, actor_user_id=7)

        assert failed.executions.executions[5].window_override_by_user_id is None

    @pytest.mark.parametrize("rule_overrides", [{"is_active": False}, {"deleted_at": "ayer"}])
    async def test_no_se_reintenta_contra_una_regla_que_ya_no_corre(self, in_memory_automations, rule_overrides):
        in_memory_automations.executions.add(
            stored_execution(id=5, status=AutomationExecutionStatus.FAILED), stored_rule(**rule_overrides),
        )

        assert await retry_automation_execution(5) is None
        assert in_memory_automations.executions.executions[5].status == AutomationExecutionStatus.FAILED


class TestNotification:
    """El aviso al admin sale del suscriptor de ExecutionFailed, después del
    commit: el motor solo publica que la ejecución falló."""

    async def _notify(
        self, monkeypatch, error: str, *, lead_id="4316bc30-f78c-57a2-8f98-bff9087678d6",
        error_code: ExecutionErrorCode | None = None,
    ):
        created: dict = {}

        async def create_notification(user_id, notification_type, title, body, lead, source_id, metadata):
            created.update(metadata=metadata, title=title, body=body, type=notification_type, user_id=user_id)
            return {"id": 1}

        send_push = AsyncMock()
        send_to_user = AsyncMock()
        monkeypatch.setattr(subscribers, "create_system_notification", create_notification)
        monkeypatch.setattr(subscribers, "send_push_to_user", send_push)
        monkeypatch.setattr(subscribers, "manager", SimpleNamespace(send_to_user=send_to_user))
        await subscribers.notify_execution_failure(ExecutionFailed(
            execution_id=100, rule_id=1, rule_name="Hollywood peel", rule_owner_id=10,
            lead_id=lead_id, error=error, error_code=error_code,
        ))
        return created, send_push, send_to_user

    async def test_la_alerta_de_ventana_cerrada_es_su_propio_evento(self, monkeypatch):
        created, _, send_to_user = await self._notify(
            monkeypatch, SERVICE_WINDOW_CLOSED_ERROR, error_code=ExecutionErrorCode.SERVICE_WINDOW_CLOSED,
        )
        assert created["type"] == NotificationType.SERVICE_WINDOW_CLOSED
        # Se conserva por compatibilidad con notificaciones ya creadas antes
        # de que este caso tuviera su propio notification_type.
        assert created["metadata"]["error_code"] == SERVICE_WINDOW_ERROR_CODE
        assert created["metadata"]["automation_execution_id"] == 100
        send_to_user.assert_awaited_once_with(10, {"type": "notification_created", "notification": {"id": 1}})

    async def test_otro_fallo_no_ofrece_la_autorizacion(self, monkeypatch):
        created, _, _ = await self._notify(monkeypatch, "La plantilla no tiene contenido para enviar")
        assert created["type"] == NotificationType.AUTOMATION
        assert "error_code" not in created["metadata"]

    async def test_la_causa_se_lee_del_codigo_no_del_texto(self, monkeypatch):
        """El mismo texto sin el código es un fallo común: nadie compara textos."""
        created, _, _ = await self._notify(monkeypatch, SERVICE_WINDOW_CLOSED_ERROR)
        assert created["type"] == NotificationType.AUTOMATION

    async def test_manda_push_al_admin_que_creo_la_regla(self, monkeypatch):
        """Antes esto solo quedaba en la campanita: si el admin no tenía el
        CRM abierto, se enteraba recién al volver a entrar."""
        _, send_push, _ = await self._notify(monkeypatch, SERVICE_WINDOW_CLOSED_ERROR)

        send_push.assert_awaited_once_with(
            10,
            "Automatización con error: Hollywood peel",
            SERVICE_WINDOW_CLOSED_ERROR,
            "/chat/4316bc30-f78c-57a2-8f98-bff9087678d6",
            tag="execution-failed-100",
        )

    async def test_el_push_va_a_automatizaciones_si_la_ejecucion_no_tiene_lead(self, monkeypatch):
        _, send_push, _ = await self._notify(monkeypatch, SERVICE_WINDOW_CLOSED_ERROR, lead_id=None)
        assert send_push.await_args.args[3] == "/automations"
