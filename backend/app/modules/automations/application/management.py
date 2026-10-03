"""Comandos de gestión: crear, editar, publicar y borrar reglas, y pausar,
reanudar, reintentar o cancelar ejecuciones.

Cada comando corre en su unidad de trabajo y registra ``AutomationsChanged``:
los paneles se refrescan (y el worker se despierta cuando hay trabajo nuevo)
recién cuando el cambio quedó confirmado.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.modules.automations.domain.types import AutomationBuilderMode, AutomationExecutionStatus, AutomationTrigger

from app.db.uow import collect, unit_of_work
from app.modules.automations.application.ports import ExecutionAlreadyRunning, automation_ports
from app.modules.automations.application.triggers import (
    backfill_customer_response_deadlines,
    schedule_automation_event,
)
from app.modules.automations.application.validation import validate_visual_flow
from app.modules.automations.domain.events import AutomationsChanged
from app.modules.automations.domain.flow_definition import normalize_visual_draft
from app.modules.leads.public import fetch_lead_raw

_DEADLINE_FIELDS = {"is_active", "trigger_type", "trigger_config", "delay_minutes"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _changed(*, wake: bool = False) -> None:
    collect(AutomationsChanged(wake=wake))


async def _backfill_if_deadline_rule(item: dict | None) -> None:
    if item and item["is_active"] and item["trigger_type"] == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE:
        await backfill_customer_response_deadlines(item["id"])


# --- Reglas -----------------------------------------------------------------

async def create_automation_rule(values: dict, user_id: int) -> dict:
    rules = automation_ports().rules
    async with unit_of_work():
        rule_id = await rules.insert(values, user_id=user_id, now=_now())
        await _changed()
    item = await rules.get(rule_id)
    await _backfill_if_deadline_rule(item)
    return item


async def duplicate_automation_rule(rule_id: int, user_id: int) -> dict | None:
    rules = automation_ports().rules
    current = await rules.get(rule_id)
    if current is None:
        return None
    is_visual = current["builder_mode"] == AutomationBuilderMode.VISUAL
    async with unit_of_work():
        new_id = await rules.insert({
            "name": f"{current['name']} (copia)"[:120],
            "trigger_type": current["trigger_type"],
            "trigger_config": current["trigger_config"],
            "conditions": {} if is_visual else current["conditions"],
            "actions": [] if is_visual else current["actions"],
            "delay_minutes": 0 if is_visual else current["delay_minutes"],
            "max_executions_per_hour": current["max_executions_per_hour"],
            # Siempre arranca inactiva: evita tener dos reglas idénticas
            # corriendo a la vez sin que el usuario lo haya decidido. Por la
            # misma razón, nunca copia visible_to_sellers=True: el admin debe
            # decidir a propósito que la copia quede visible para vendedores.
            "is_active": False,
            "visible_to_sellers": False,
            "builder_mode": current["builder_mode"],
            "flow_definition": current["flow_definition"] if is_visual else {},
            "published_flow_definition": None,
            "flow_version": 0,
        }, user_id=user_id, now=_now())
        await _changed()
    return await rules.get(new_id)


async def update_automation_rule(rule_id: int, values: dict) -> dict | None:
    rules = automation_ports().rules
    if values:
        values = {**values, "updated_at": _now()}
        async with unit_of_work():
            if not await rules.update(rule_id, values):
                return None
            await _changed()
    item = await rules.get(rule_id)
    if _DEADLINE_FIELDS & set(values):
        await _backfill_if_deadline_rule(item)
    return item


async def delete_automation_rule(rule_id: int) -> dict | None:
    """Oculta una regla sin destruir sus ejecuciones ni versiones auditables.

    Las ejecuciones programadas se cierran como omitidas. Una ejecución que ya
    está corriendo bloquea el borrado porque podría completar acciones después
    de que el usuario creyera eliminada la automatización.
    """
    rules = automation_ports().rules
    async with unit_of_work():
        statuses = await rules.lock_active_statuses(rule_id)
        if statuses is None:
            return None
        if AutomationExecutionStatus.RUNNING in statuses:
            raise ValueError(
                "La automatización tiene una ejecución en curso. Cancélala o espera a que termine antes de eliminarla."
            )
        cancelled = await rules.retire(rule_id, _now())
        await _changed()
    return {"id": rule_id, "cancelled_executions": cancelled}


# --- Flujos visuales --------------------------------------------------------

async def create_visual_flow(name: str, definition: dict, user_id: int) -> dict:
    validated = normalize_visual_draft(name, definition)
    rules = automation_ports().rules
    async with unit_of_work():
        rule_id = await rules.insert({
            "name": validated["name"],
            "trigger_type": validated["trigger_type"],
            "trigger_config": validated["trigger_config"],
            "conditions": {}, "actions": [], "delay_minutes": 0, "is_active": False,
            "builder_mode": AutomationBuilderMode.VISUAL,
            "flow_definition": validated["flow_definition"],
            "published_flow_definition": None, "flow_version": 0,
        }, user_id=user_id, now=_now())
        await _changed()
    return await rules.get(rule_id)


async def _visual_flow(rule_id: int) -> dict | None:
    current = await automation_ports().rules.get(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return None
    return current


async def save_visual_flow(rule_id: int, name: str, definition: dict) -> dict | None:
    if await _visual_flow(rule_id) is None:
        return None
    validated = normalize_visual_draft(name, definition)
    return await update_automation_rule(rule_id, {
        "name": validated["name"],
        "flow_definition": validated["flow_definition"],
    })


async def publish_visual_flow(rule_id: int) -> dict | None:
    current = await _visual_flow(rule_id)
    if current is None:
        return None
    validated = await validate_visual_flow(
        current["name"], current["flow_definition"], current_rule_id=rule_id,
    )
    if validated["flow_definition"] == current["published_flow_definition"]:
        raise ValueError("No hay cambios pendientes para publicar")
    rules = automation_ports().rules
    async with unit_of_work():
        await rules.publish(rule_id, validated, version=current["flow_version"] + 1, now=_now())
        await _changed()
    item = await rules.get(rule_id)
    await _backfill_if_deadline_rule(item)
    return item


async def restore_flow_version(rule_id: int, version: int) -> dict | None:
    """Carga una versión publicada como borrador.

    No republica ni reactiva: deja el flujo listo para revisar y, si convence,
    publicar. Así restaurar nunca cambia por sí solo lo que se está ejecutando.
    """
    current = await _visual_flow(rule_id)
    if current is None:
        return None
    definition = await automation_ports().executions.flow_definition(rule_id, version)
    if not definition:
        return None
    validated = normalize_visual_draft(current["name"], definition)
    return await update_automation_rule(rule_id, {"flow_definition": validated["flow_definition"]})


# --- Ejecuciones ------------------------------------------------------------

async def retry_automation_execution(
    execution_id: int,
    *,
    ignore_service_window: bool = False,
    actor_user_id: int | None = None,
) -> dict | None:
    """Reintenta una ejecución failed o skipped desde donde quedó — no repite
    acciones ya persistidas en action_results. Nunca aplica a completed: eso
    reiniciaría el flujo desde el disparador y reenviaría lo ya enviado.

    Resetea attempts a 0: es un reinicio explícito del usuario, no debería
    heredar el contador de recuperaciones automáticas agotado que la llevó a
    failed.

    Con `ignore_service_window` el admin autoriza a esta ejecución (y solo a
    esta) a enviar con la ventana de 24 h cerrada, y queda registrado quién lo
    hizo. Cada reintento define el permiso de nuevo: uno común lo limpia, para
    que una autorización vieja no se arrastre sin que nadie la pida."""
    executions = automation_ports().executions
    async with unit_of_work():
        execution, rule = await executions.load(execution_id)
        if execution is None or execution.status not in {
            AutomationExecutionStatus.FAILED, AutomationExecutionStatus.SKIPPED,
        }:
            return None
        if rule is None or rule.deleted_at is not None or not rule.is_active:
            return None
        requeued = await executions.requeue(
            execution_id, _now(), override_by_user_id=actor_user_id if ignore_service_window else None,
        )
        if not requeued:
            return None
        await _changed(wake=True)
    return await executions.view(execution_id)


async def pause_lead_executions(lead_id: str) -> int:
    """Al pausar la automatización de un lead, congela lo que tiene programado
    de disparadores de sistema en vez de cancelarlo: `paused`, con
    `scheduled_for` intacto y `paused_at` marcando desde cuándo, para que
    `resume_lead_executions` le devuelva el tiempo que le faltaba.

    No toca lo que está corriendo en este instante (el motor la congela al
    llegar a su siguiente espera) ni los flujos manuales del vendedor, que
    pidió a propósito y puede pausar o cancelar uno por uno desde el chat."""
    async with unit_of_work():
        paused = await automation_ports().executions.pause_lead(lead_id, _now())
        if paused:
            await _changed()
    return paused


async def resume_lead_executions(lead_id: str) -> int:
    """Devuelve a la cola lo que quedó congelado por la pausa del lead, con el
    tiempo que le faltaba.

    `waiting_since` de los bloques Pausa/Pregunta no se corre a propósito: si
    el cliente escribió mientras el vendedor atendía a mano, esa respuesta es
    real y el flujo debe seguir por la rama del mensaje.

    Solo descongela lo que congeló la pausa del lead: una ejecución que el
    vendedor pausó puntualmente sigue detenida hasta que la reanude con su
    propio botón."""
    async with unit_of_work():
        resumed = await automation_ports().executions.resume_lead(lead_id, _now())
        if resumed:
            await _changed(wake=True)
    return resumed


async def pause_automation_execution(execution_id: int) -> dict | None:
    """Congela una sola ejecución: el botón de pausa del panel de
    automatizaciones del chat. A diferencia de la pausa del lead, acá sí
    entran los flujos manuales.

    Solo aplica a una ejecución `scheduled`; una `running` está enviando un
    paso en este instante y no se interrumpe. Devuelve None para que el
    caller lo explique."""
    executions = automation_ports().executions
    async with unit_of_work():
        if not await executions.pause(execution_id, _now()):
            return None
        await _changed()
    return await executions.view(execution_id)


async def resume_automation_execution(execution_id: int) -> dict | None:
    """Devuelve a la cola una ejecución congelada, con el tiempo que le
    faltaba. Sirve para las dos pausas: la puntual del vendedor y la que dejó
    la pausa del lead.

    Con el lead todavía pausado no tiene sentido: el motor la volvería a
    congelar al vencer. Eso se corta acá con un error claro — salvo en los
    flujos manuales, que la pausa del lead nunca frena."""
    executions = automation_ports().executions
    async with unit_of_work():
        execution, _rule = await executions.load(execution_id)
        if execution is None or execution.status != AutomationExecutionStatus.PAUSED:
            return None
        if execution.start_source != "manual" and execution.lead_id:
            lead = await fetch_lead_raw(execution.lead_id)
            if lead is not None and lead.get("automatizacion_pausada"):
                raise ValueError(
                    "Este chat tiene la automatización pausada: reanudala con el botón "
                    "del bot en la cabecera para que el flujo siga."
                )
        if not await executions.resume(execution_id, _now()):
            return None
        await _changed(wake=True)
    return await executions.view(execution_id)


async def cancel_automation_execution(execution_id: int) -> dict | None:
    executions = automation_ports().executions
    async with unit_of_work():
        if not await executions.cancel(execution_id, _now()):
            return None
        await _changed()
    return await executions.view(execution_id)


async def start_manual_flow_execution(
    rule_id: int, lead_id: str, started_by_user_id: int, is_admin: bool,
) -> dict:
    """Arranca, con un click del vendedor, una ejecución de un flujo visual de
    trigger manual sobre un lead puntual.

    A diferencia de los triggers de sistema (que dedupan por event_key fijo),
    acá el vendedor debe poder repetir el mismo flujo sobre el mismo lead una
    vez que la ejecución anterior terminó — por eso la event_key lleva un uuid
    único por click. Lo que sí impide una segunda ejecución en curso es el
    índice único parcial (rule_id, lead_id) sobre ejecuciones manuales no
    terminales: un doble click o dos vendedores chocan contra él y ese
    conflicto se traduce en un mensaje claro en vez de un 500.
    """
    rule = await automation_ports().rules.get(rule_id)
    if rule is None:
        raise ValueError("Flujo no encontrado")
    if rule["builder_mode"] != AutomationBuilderMode.VISUAL or rule["trigger_type"] != AutomationTrigger.MANUAL:
        raise ValueError("La regla no es un flujo de inicio manual")
    if not rule["is_active"]:
        raise ValueError("Publica y activa el flujo antes de iniciarlo")
    if not is_admin and not rule["visible_to_sellers"]:
        raise ValueError("Este flujo no está disponible para vendedores")

    event_key = f"manual:{uuid4()}"
    try:
        created = await schedule_automation_event(
            AutomationTrigger.MANUAL,
            lead_id,
            event_key=event_key,
            payload={"started_by_user_id": started_by_user_id},
            rule_id=rule_id,
            started_by_user_id=started_by_user_id,
            start_source="manual",
        )
    except ExecutionAlreadyRunning as exc:
        raise ValueError(
            "Ya hay una ejecución de este flujo en curso para este lead. "
            "Esperá a que termine o cancelala antes de iniciar otra."
        ) from exc
    if not created:
        raise ValueError("No se pudo iniciar el flujo: verifica que el lead exista")

    executions = automation_ports().executions
    execution_id = await executions.find_by_event_key(rule_id, event_key)
    execution = await executions.view(execution_id) if execution_id else None
    if execution is None:
        raise ValueError("No se pudo recuperar la ejecución iniciada")
    return execution
