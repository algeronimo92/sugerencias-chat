"""El motor: corre las ejecuciones vencidas, paso a paso.

Cada paso queda guardado apenas termina (``ExecutionStore.save``), así que un
reinicio retoma desde lo último que se hizo y nunca repite un WhatsApp ya
encolado. Lo que pasa se avisa con eventos; el motor no conoce el WebSocket
ni las notificaciones.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from domain_types import AutomationBuilderMode, AutomationExecutionStatus, FlowNodeType

from app.integrations.whatsapp.channel import SEND_FAILURES
from app.modules.automations.application.actions import execute_action
from app.modules.automations.application.conditions import matches_condition_values
from app.modules.automations.application.deps import AutomationDeps, default_deps
from app.modules.automations.application.flow_nodes import FlowRun, flow_node_handler
from app.modules.automations.domain.events import AutomationsChanged, ExecutionFailed
from app.modules.automations.domain.execution import (
    TERMINAL_STATUSES,
    deadline_already_fired,
    deadline_matches,
    execution_message_context,
    resumable_results,
)
from app.modules.automations.domain.flow_graph import flow_indexes
from app.modules.automations.domain.limits import MAX_CONCURRENT_EXECUTIONS, MAX_FLOW_NODES, RATE_LIMIT_RETRY_MINUTES

logger = logging.getLogger(__name__)

# Lo que un paso puede levantar como fallo esperado: un dato inválido o el
# canal que no aceptó el envío. Cualquier otra cosa se registra como error
# inesperado, pero igual deja la ejecución en failed.
EXPECTED_FAILURES: tuple[type[Exception], ...] = (KeyError, ValueError, *SEND_FAILURES)


async def save_execution(execution_id: int, deps: AutomationDeps, **values) -> bool:
    """Punto de escritura del estado de una ejecución mientras corre.

    Pone finished_at solo cuando el estado es terminal, para que ninguna rama
    se olvide de marcarlo.

    Nunca pisa una fila que ya quedó skipped: eso significa que alguien la
    canceló mientras este motor la tenía en curso. Devuelve False en ese caso
    para que el caller corte el procesamiento en vez de seguir enviando
    acciones de una ejecución cancelada."""
    if values.get("status") in TERMINAL_STATUSES:
        values.setdefault("finished_at", deps.now())
    return await deps.executions.save(execution_id, **values)


async def _persist_visual_execution(
    execution_id: int,
    status: AutomationExecutionStatus,
    results: list[dict],
    current_node_id: str | None,
    path: list[str],
    flow_version: int,
    deps: AutomationDeps,
    error: str | None = None,
    scheduled_for: datetime | None = None,
    wait_any_state: dict | None = None,
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
    return await save_execution(execution_id, deps, **values)


async def _failed(rule, execution, error: str, deps: AutomationDeps) -> None:
    await deps.publish(ExecutionFailed(
        execution_id=execution.id,
        rule_id=rule.id,
        rule_name=rule.name,
        rule_owner_id=rule.created_by_user_id,
        lead_id=execution.lead_id,
        error=error,
    ))


async def _resolve_flow_definition(rule, state: dict, flow_version: int, deps: AutomationDeps) -> dict:
    # Orden de resolución: snapshot legacy embebido en flow_state (ejecuciones
    # en vuelo anteriores a automation_flow_versions) → la versión pinneada en
    # la tabla de versiones → la última definición publicada de la regla.
    legacy = state.get("definition")
    if legacy:
        return legacy
    definition = await deps.executions.flow_definition(rule.id, flow_version)
    return definition or rule.published_flow_definition or {}


async def run_visual_execution(execution, rule, chat: dict, deps: AutomationDeps) -> None:
    state = execution.flow_state or {}
    flow_version = int(state.get("flow_version") or rule.flow_version or 0)
    definition = await _resolve_flow_definition(rule, state, flow_version, deps)
    nodes, edges = flow_indexes(definition)
    if not nodes:
        await _persist_visual_execution(
            execution.id, AutomationExecutionStatus.FAILED, execution.action_results or [], None, [],
            flow_version, deps, "El flujo no tiene una versión publicada",
        )
        return
    path = list(state.get("path") or [])
    results = list(execution.action_results or [])
    message_context = execution_message_context(execution)
    current_id = state.get("current_node_id")
    if not current_id:
        matches, reason = await matches_condition_values(
            definition.get("conditions") if isinstance(definition.get("conditions"), dict) else {},
            chat,
            rule.id,
            deps,
        )
        if not matches:
            results.append({
                "position": len(results) + 1,
                "type": "entry_conditions",
                "status": AutomationExecutionStatus.SKIPPED,
                "detail": reason,
            })
            await _persist_visual_execution(
                execution.id, AutomationExecutionStatus.SKIPPED, results, None, path, flow_version, deps, reason,
            )
            return
        trigger = next((node for node in nodes.values() if node["type"] == FlowNodeType.TRIGGER), None)
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
            outcome = await flow_node_handler(node["type"]).execute(node, run)
            if outcome.status == AutomationExecutionStatus.RUNNING:
                current_id = outcome.next_node_id
                saved = await _persist_visual_execution(
                    execution.id, AutomationExecutionStatus.RUNNING, results, current_id, path, flow_version, deps,
                )
                if not saved:
                    return  # cancelada externamente: no proceses más nodos
                continue
            await _persist_visual_execution(
                execution.id, outcome.status, results, outcome.next_node_id, path, flow_version, deps,
                scheduled_for=outcome.scheduled_for, wait_any_state=outcome.wait_state,
            )
            return
        raise ValueError("El flujo excedió el máximo de bloques permitidos")
    except Exception as exc:
        if not isinstance(exc, EXPECTED_FAILURES):
            logger.exception("Error inesperado al ejecutar la automatización visual %s", execution.id)
        action_type = (
            flow_node_handler(nodes[current_id]["type"]).failure_type(nodes[current_id])
            if current_id in nodes else "flow"
        )
        if isinstance(exc, EXPECTED_FAILURES):
            results.append({
                "position": len(results) + 1, "node_id": current_id,
                "type": action_type,
                "status": AutomationExecutionStatus.FAILED,
                "error": str(exc),
            })
        await _persist_visual_execution(
            execution.id, AutomationExecutionStatus.FAILED, results, current_id, path, flow_version, deps, str(exc),
        )
        await _failed(rule, execution, str(exc), deps)


async def _rate_limit_reached(rule, deps: AutomationDeps) -> bool:
    if not rule.max_executions_per_hour:
        return False
    recent = await deps.executions.completed_since(rule.id, deps.now() - timedelta(hours=1))
    return (recent or 0) >= rule.max_executions_per_hour


async def _customer_response_deadline_is_current(execution, deps: AutomationDeps) -> bool:
    """Última defensa contra carreras entre el vencimiento y una respuesta."""
    if deadline_already_fired(execution):
        return True
    if not (execution.event_payload or {}).get("last_message_id") or not execution.lead_id:
        return False
    return deadline_matches(execution, await deps.latest_message(execution.lead_id))


async def run_execution(execution_id: int, deps: AutomationDeps | None = None) -> None:
    deps = deps or default_deps()
    execution, rule = await deps.executions.load(execution_id)
    if not execution or not rule:
        return
    if not rule.is_active:
        await save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.SKIPPED, error="La regla fue desactivada",
        )
        return
    if not await _customer_response_deadline_is_current(execution, deps):
        await save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.SKIPPED,
            error="El chat cambió antes del vencimiento; no se ejecutó el cierre",
        )
        return
    if await _rate_limit_reached(rule, deps):
        # Se re-agenda en vez de descartarse: el tope frena el ritmo, no
        # cancela el trabajo pendiente.
        await save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.SCHEDULED,
            scheduled_for=deps.now() + timedelta(minutes=RATE_LIMIT_RETRY_MINUTES),
            started_at=None,
            error=f"Límite de {rule.max_executions_per_hour} ejecuciones/hora alcanzado; reintentando más tarde",
        )
        return
    chat = await deps.fetch_chat(execution.lead_id) if execution.lead_id else None
    if not chat:
        await save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.FAILED, error="Lead no encontrado",
        )
        await _failed(rule, execution, "Lead no encontrado", deps)
        return
    if rule.builder_mode == AutomationBuilderMode.VISUAL:
        await run_visual_execution(execution, rule, chat, deps)
        return

    previous = list(execution.action_results or [])
    results = resumable_results(previous)
    if not previous:
        # Solo se evalúan condiciones en el primer intento: al reanudar una
        # ejecución interrumpida las acciones ya corridas pudieron cambiar el
        # estado del lead y un skip aquí dejaría la regla a medias.
        matches, reason = await matches_condition_values(rule.conditions or {}, chat, rule.id, deps)
        if not matches:
            await save_execution(
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
            result = await execute_action(
                actions[index], chat, execution, rule, deps, position=index + 1,
            )
            results.append({"position": index + 1, **result})
            saved = await save_execution(execution_id, deps, action_results=results)
            if not saved:
                return  # cancelada externamente: no proceses más acciones
    except Exception as exc:
        if isinstance(exc, EXPECTED_FAILURES) and not isinstance(exc, KeyError):
            failed_type = actions[len(results)].get("type") if len(results) < len(actions) else None
            results.append({
                "position": len(results) + 1,
                "type": failed_type,
                "status": AutomationExecutionStatus.FAILED,
                "error": str(exc),
            })
        else:
            logger.exception("Error inesperado al ejecutar la automatización %s", execution_id)
        await save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.FAILED, action_results=results, error=str(exc),
        )
        await _failed(rule, execution, str(exc), deps)
    else:
        await save_execution(
            execution_id, deps,
            status=AutomationExecutionStatus.COMPLETED, action_results=results, error=None,
        )


async def process_due_automation_executions(limit: int = 20, deps: AutomationDeps | None = None) -> int:
    deps = deps or default_deps()
    # Antes de reclamar nada se congela lo que venció con el lead pausado: la
    # pausa solo alcanza a lo que ya estaba esperando, y esto atrapa además a
    # la ejecución que estaba corriendo cuando el vendedor pausó y volvió a la
    # cola al llegar a su siguiente espera.
    frozen, ids = await deps.executions.claim_due(deps.now(), limit)
    if frozen:
        await deps.publish(AutomationsChanged())
    if not ids:
        return 0
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXECUTIONS)

    async def run_bounded(execution_id: int) -> None:
        async with semaphore:
            await run_execution(execution_id, deps)

    await asyncio.gather(*(run_bounded(execution_id) for execution_id in ids))
    await deps.publish(AutomationsChanged())
    return len(ids)
