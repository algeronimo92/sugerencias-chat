import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select, update

from db.models import (
    AutomationExecution,
    AutomationFlowVersion,
    AutomationRule,
    Lead,
    WspMessage,
)
from db.session import get_sessionmaker
from domain_types import (
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationTrigger,
    FlowNodeType,
    NotificationType,
)
from services.automation_deps import DEFAULT_DEPS, AutomationDeps
from services.automations.actions import (
    _execute_action,
)
from services.automations.common import (
    MAX_CONCURRENT_EXECUTIONS,
    MAX_FLOW_NODES,
    PAUSE_SCOPE_LEAD,
    RATE_LIMIT_RETRY_MINUTES,
    SERVICE_WINDOW_CLOSED_ERROR,
    SERVICE_WINDOW_ERROR_CODE,
    _flow_indexes,
)
from services.automations.conditions import (
    _execution_message_context,
    _matches_condition_values,
    _matches_conditions,
)
from services.automations.flow_nodes import (
    FlowRun,
    _flow_node_handler,
)
from services.whatsapp_channel import ChannelError
from services.ws_manager import manager

logger = logging.getLogger(__name__)


def _resumable_results(results: list[dict]) -> list[dict]:
    return [
        result for result in results
        if result.get("status") != AutomationExecutionStatus.FAILED
    ]


async def _persist_visual_execution(
    execution_id: int,
    status: AutomationExecutionStatus,
    results: list[dict],
    current_node_id: str | None,
    path: list[str],
    flow_version: int,
    error: str | None = None,
    scheduled_for: datetime | None = None,
    wait_any_state: dict | None = None,
    deps: AutomationDeps = DEFAULT_DEPS,
) -> bool:
    values = {
        "status": status,
        "action_results": results,
        "flow_state": {
            "flow_version": flow_version,
            "current_node_id": current_node_id,
            "path": path,
            # Solo lo llevan los bloques Pausa (wait_any) mientras están
            # esperando — omitirlo acá los limpia al avanzar a otro bloque.
            **(wait_any_state or {}),
        },
        "error": error,
    }
    if scheduled_for is not None:
        # Una espera del flujo: la ejecución vuelve a la cola, así que se
        # limpian las marcas de "ya arrancó/terminó".
        values["scheduled_for"] = scheduled_for
        values["started_at"] = None
        values["finished_at"] = None
    return await _save_execution(execution_id, deps, **values)


async def _notify_execution_failure(
    rule: AutomationRule,
    execution: AutomationExecution,
    error: str,
    deps: AutomationDeps = DEFAULT_DEPS,
) -> None:
    """Avisa al admin que creó la regla cuando una ejecución queda en failed —
    sin esto los fallos solo se descubren entrando al historial a mirar."""
    is_service_window_error = error == SERVICE_WINDOW_CLOSED_ERROR
    title = f"Automatización con error: {rule.name}"[:160]
    body = (error or "La ejecución falló")[:1000]
    try:
        notification = await deps.create_notification(
            rule.created_by_user_id,
            # Ventana de 24 h cerrada es su propio evento, no un AUTOMATION
            # genérico: así el frontend lo distingue por notification_type y
            # no por leer la metadata.
            NotificationType.SERVICE_WINDOW_CLOSED if is_service_window_error else NotificationType.AUTOMATION,
            title,
            body,
            execution.lead_id,
            f"execution-failed:{execution.id}",
            {
                "automation_rule_id": rule.id,
                "automation_execution_id": execution.id,
                # Se conserva por compatibilidad con notificaciones ya creadas
                # antes de que este caso tuviera su propio notification_type.
                **({"error_code": SERVICE_WINDOW_ERROR_CODE} if is_service_window_error else {}),
            },
        )
        await deps.send_to_user(
            rule.created_by_user_id, {"type": "notification_created", "notification": notification}
        )
        # Antes esto solo quedaba en la campanita: si el admin no tenía el CRM
        # abierto, se enteraba recién al volver a entrar. Va al lead si la
        # ejecución tiene uno, y si no a la pantalla de automatizaciones.
        await deps.send_push(
            rule.created_by_user_id,
            title,
            body,
            f"/chat/{execution.lead_id}" if execution.lead_id else "/automations",
            tag=f"execution-failed-{execution.id}",
        )
    except Exception:
        logger.exception("No se pudo notificar el fallo de la ejecución %s", execution.id)


async def _resolve_flow_definition(
    rule: AutomationRule, state: dict, flow_version: int, deps: AutomationDeps = DEFAULT_DEPS
) -> dict:
    # Orden de resolución: snapshot legacy embebido en flow_state (ejecuciones
    # en vuelo anteriores a automation_flow_versions) → la versión pinneada en
    # la tabla de versiones → la última definición publicada de la regla.
    legacy = state.get("definition")
    if legacy:
        return legacy
    async with get_sessionmaker()() as session:
        definition = await session.scalar(select(AutomationFlowVersion.definition).where(
            AutomationFlowVersion.rule_id == rule.id,
            AutomationFlowVersion.version == flow_version,
        ))
    return definition or rule.published_flow_definition or {}


async def _run_visual_execution(
    execution: AutomationExecution, rule: AutomationRule, chat: dict,
    deps: AutomationDeps = DEFAULT_DEPS,
) -> None:
    state = execution.flow_state or {}
    flow_version = int(state.get("flow_version") or rule.flow_version or 0)
    definition = await _resolve_flow_definition(rule, state, flow_version, deps)
    nodes, edges = _flow_indexes(definition)
    if not nodes:
        await _persist_visual_execution(
            execution.id,
            AutomationExecutionStatus.FAILED,
            execution.action_results or [],
            None,
            [],
            flow_version,
            "El flujo no tiene una versión publicada",
        deps=deps,
        )
        return
    path = list(state.get("path") or [])
    results = list(execution.action_results or [])
    message_context = _execution_message_context(execution)
    current_id = state.get("current_node_id")
    if not current_id:
        matches, reason = await _matches_condition_values(
            definition.get("conditions") if isinstance(definition.get("conditions"), dict) else {},
            chat,
            rule.id,
        )
        if not matches:
            results.append({
                "position": len(results) + 1,
                "type": "entry_conditions",
                "status": AutomationExecutionStatus.SKIPPED,
                "detail": reason,
            })
            await _persist_visual_execution(
                execution.id,
                AutomationExecutionStatus.SKIPPED,
                results,
                None,
                path,
                flow_version,
                reason,
            deps=deps,
            )
            return
        trigger = next(
            (
                node
                for node in nodes.values()
                if node["type"] == FlowNodeType.TRIGGER
            ),
            None,
        )
        current_id = trigger["id"] if trigger else None
    run = FlowRun(
        execution=execution, rule=rule, chat=chat, deps=deps, state=state,
        edges=edges, results=results, message_context=message_context,
    )
    try:
        for _ in range(MAX_FLOW_NODES + 1):
            if not current_id or current_id not in nodes:
                raise ValueError("El flujo perdió la referencia al siguiente bloque")
            node = nodes[current_id]
            path.append(current_id)
            outcome = await _flow_node_handler(node["type"]).execute(node, run)
            if outcome.status == AutomationExecutionStatus.RUNNING:
                current_id = outcome.next_node_id
                saved = await _persist_visual_execution(
                    execution.id, AutomationExecutionStatus.RUNNING, results, current_id, path, flow_version,
                    deps=deps,
                )
                if not saved:
                    return  # cancelada externamente: no proceses más nodos
                continue
            await _persist_visual_execution(
                execution.id, outcome.status, results, outcome.next_node_id, path, flow_version,
                scheduled_for=outcome.scheduled_for, wait_any_state=outcome.wait_state, deps=deps,
            )
            return
        raise ValueError("El flujo excedió el máximo de bloques permitidos")
    except (KeyError, ValueError, ChannelError, httpx.HTTPError) as exc:
        action_type = (
            _flow_node_handler(nodes[current_id]["type"]).failure_type(nodes[current_id])
            if current_id in nodes else "flow"
        )
        results.append({
            "position": len(results) + 1, "node_id": current_id,
            "type": action_type,
            "status": AutomationExecutionStatus.FAILED,
            "error": str(exc),
        })
        await _persist_visual_execution(
            execution.id,
            AutomationExecutionStatus.FAILED,
            results,
            current_id,
            path,
            flow_version,
            str(exc),
        deps=deps,
        )
        await _notify_execution_failure(rule, execution, str(exc), deps)
    except Exception as exc:
        logger.exception("Error inesperado al ejecutar la automatización visual %s", execution.id)
        await _persist_visual_execution(
            execution.id,
            AutomationExecutionStatus.FAILED,
            results,
            current_id,
            path,
            flow_version,
            str(exc),
        deps=deps,
        )
        await _notify_execution_failure(rule, execution, str(exc))


async def _save_execution(
    execution_id: int,
    deps: AutomationDeps = DEFAULT_DEPS,
    **values,
) -> bool:
    """Punto de escritura del estado de una ejecución durante _run_execution/
    _run_visual_execution (_discover_wait_any_replies escribe aparte con el
    mismo criterio de guarda de abajo).

    Pone finished_at solo cuando el estado es terminal, para que ninguna rama
    se olvide de marcarlo (antes esto estaba copiado en 15 lugares).

    Nunca pisa una fila que ya quedó skipped: eso significa que alguien la
    canceló externamente (cancel_automation_execution) mientras este motor
    la tenía en curso. Devuelve False en ese caso para que el caller corte el
    procesamiento en vez de seguir enviando acciones de una ejecución
    cancelada."""
    if values.get("status") in {
        AutomationExecutionStatus.COMPLETED,
        AutomationExecutionStatus.FAILED,
        AutomationExecutionStatus.SKIPPED,
    }:
        values.setdefault("finished_at", deps.now())
    async with deps.session() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.status != AutomationExecutionStatus.SKIPPED,
        ).values(**values))
        await session.commit()
    return bool(result.rowcount)


async def _rate_limit_reached(rule: AutomationRule, deps: AutomationDeps) -> bool:
    if not rule.max_executions_per_hour:
        return False
    since = deps.now() - timedelta(hours=1)
    async with deps.session() as session:
        recent = await session.scalar(
            select(func.count(AutomationExecution.id)).where(
                AutomationExecution.rule_id == rule.id,
                AutomationExecution.status == AutomationExecutionStatus.COMPLETED,
                AutomationExecution.finished_at >= since,
            )
        )
    return (recent or 0) >= rule.max_executions_per_hour


async def _customer_response_deadline_is_current(
    execution: AutomationExecution,
    deps: AutomationDeps,
) -> bool:
    """Última defensa contra carreras entre el vencimiento y una respuesta."""
    if getattr(execution, "trigger_type", None) != AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE:
        return True
    # Una ejecución visual puede quedar SCHEDULED por un nodo de espera. Para
    # entonces el deadline ya disparó y no debe volver a validarse ni
    # cancelarse por mensajes que sean parte del propio flujo.
    flow_state = getattr(execution, "flow_state", None) or {}
    if (
        getattr(execution, "action_results", None)
        or flow_state.get("current_node_id")
        or flow_state.get("path")
    ):
        return True
    payload = execution.event_payload or {}
    expected_id = str(payload.get("last_message_id") or "")
    if not expected_id or not execution.lead_id:
        return False
    async with deps.session() as session:
        row = (await session.execute(select(
            WspMessage.id,
            WspMessage.wa_message_id,
            WspMessage.sender,
        ).where(
            WspMessage.chat_id == execution.lead_id,
        ).order_by(
            WspMessage.sent_at.desc(), WspMessage.id.desc()
        ).limit(1))).mappings().first()
    if row is None or row["sender"] != "vendedor":
        return False
    current_id = str(row["wa_message_id"] or row["id"])
    return current_id == expected_id


async def _run_execution(execution_id: int, deps: AutomationDeps = DEFAULT_DEPS) -> None:
    async with deps.session() as session:
        execution = await session.get(AutomationExecution, execution_id)
        rule = await session.get(AutomationRule, execution.rule_id) if execution else None
    if not execution or not rule:
        return
    if not rule.is_active:
        await _save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.SKIPPED, error="La regla fue desactivada",
        )
        return
    if not await _customer_response_deadline_is_current(execution, deps):
        await _save_execution(
            execution_id,
            deps,
            status=AutomationExecutionStatus.SKIPPED,
            error="El chat cambió antes del vencimiento; no se ejecutó el cierre",
        )
        return
    if await _rate_limit_reached(rule, deps):
        # Se re-agenda en vez de descartarse: el tope frena el ritmo, no
        # cancela el trabajo pendiente.
        await _save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.SCHEDULED,
            scheduled_for=deps.now() + timedelta(minutes=RATE_LIMIT_RETRY_MINUTES),
            started_at=None,
            error=f"Límite de {rule.max_executions_per_hour} ejecuciones/hora alcanzado; reintentando más tarde",
        )
        return
    chat = await deps.fetch_chat(execution.lead_id) if execution.lead_id else None
    if not chat:
        await _save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.FAILED, error="Lead no encontrado",
        )
        await _notify_execution_failure(rule, execution, "Lead no encontrado", deps)
        return
    if rule.builder_mode == AutomationBuilderMode.VISUAL:
        await _run_visual_execution(execution, rule, chat, deps)
        return

    previous = list(execution.action_results or [])
    results = _resumable_results(previous)
    if not previous:
        # Solo se evalúan condiciones en el primer intento: al reanudar una
        # ejecución interrumpida las acciones ya corridas pudieron cambiar el
        # estado del lead y un skip aquí dejaría la regla a medias.
        matches, reason = await _matches_conditions(rule, chat, deps)
        if not matches:
            await _save_execution(
                execution_id, deps,
                status=AutomationExecutionStatus.SKIPPED, error=reason,
            )
            return
    actions = list(rule.actions or [])
    try:
        # Reanuda desde la primera acción sin resultado exitoso persistido — un
        # reintento tras un crash no repite WhatsApps ni tareas ya creadas, pero
        # sí vuelve a intentar la que quedó fallida.
        for index in range(len(results), len(actions)):
            result = await _execute_action(
                actions[index], chat, execution, rule, deps, position=index + 1,
            )
            results.append({"position": index + 1, **result})
            saved = await _save_execution(execution_id, deps, action_results=results)
            if not saved:
                return  # cancelada externamente: no proceses más acciones
    except (ValueError, ChannelError, httpx.HTTPError) as exc:
        failed_type = actions[len(results)].get("type") if len(results) < len(actions) else None
        results.append({
            "position": len(results) + 1,
            "type": failed_type,
            "status": AutomationExecutionStatus.FAILED,
            "error": str(exc),
        })
        await _save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.FAILED, action_results=results, error=str(exc),
        )
        await _notify_execution_failure(rule, execution, str(exc), deps)
    except Exception as exc:
        logger.exception("Error inesperado al ejecutar la automatización %s", execution_id)
        await _save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.FAILED, action_results=results, error=str(exc),
        )
        await _notify_execution_failure(rule, execution, str(exc), deps)
    else:
        await _save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.COMPLETED, action_results=results, error=None,
        )


async def process_due_automation_executions(limit: int = 20) -> int:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        # Antes de reclamar nada, congela lo que venció con el lead pausado.
        # `pause_lead_executions` solo alcanza a lo que ya estaba esperando en
        # ese momento; esto atrapa además a la ejecución que estaba corriendo
        # cuando el vendedor pausó y volvió a la cola al llegar a su siguiente
        # espera — sin esto seguiría viva atravesando el flujo entero con el
        # lead pausado. Va en la misma transacción que el SELECT de abajo, así
        # que las congeladas ya no se ven como reclamables.
        frozen = (await session.execute(update(AutomationExecution).where(
            AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            AutomationExecution.scheduled_for <= now,
            AutomationExecution.start_source != "manual",
            AutomationExecution.lead_id.in_(
                select(Lead.id).where(Lead.automatizacion_pausada.is_(True))
            ),
        ).values(
            status=AutomationExecutionStatus.PAUSED,
            paused_at=now,
            pause_scope=PAUSE_SCOPE_LEAD,
            error=None,
        ).returning(AutomationExecution.id))).scalars().all()
        ids = (await session.execute(
            select(AutomationExecution.id).where(
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                AutomationExecution.scheduled_for <= now,
            ).order_by(AutomationExecution.scheduled_for.asc()).limit(limit).with_for_update(skip_locked=True)
        )).scalars().all()
        if ids:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id.in_(ids)
            ).values(
                status=AutomationExecutionStatus.RUNNING,
                started_at=now,
                error=None,
            ))
        await session.commit()
    if frozen:
        await manager.broadcast({"type": "automations_updated"})
    if not ids:
        return 0
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXECUTIONS)

    async def run_bounded(execution_id: int) -> None:
        async with semaphore:
            await _run_execution(execution_id)

    await asyncio.gather(*(run_bounded(execution_id) for execution_id in ids))
    await manager.broadcast({"type": "automations_updated"})
    return len(ids)
