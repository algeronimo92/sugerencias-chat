import asyncio
import logging
import unicodedata
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import uuid4

import httpx
from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from domain_types import (
    AutomationActionType,
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationRecipient,
    AutomationTrigger,
    FlowConditionType,
    FlowHandle,
    FlowNodeType,
    InteractiveType,
    NotificationType,
    QuestionHandle,
    TaskPriority,
    TaskStatus,
    TaskType,
    TemplateType,
    WaitAnyConditionKind,
)
from db.models import (
    AutomationExecution,
    AutomationFlowVersion,
    AutomationRule,
    Lead,
    LeadActivity,
    LeadStage,
    LeadTag,
    LeadTask,
    MediaAsset,
    MessageTemplate,
    TemplateAttachment,
    User,
    WspMessage,
)
from db.session import get_sessionmaker
from services.db_service import (
    assign_tag,
    fetch_chat,
    get_customer_service_window,
    insert_message,
    remove_tag,
    update_lead,
    update_lead_stage,
)
from services.evolution_service import (
    EvolutionApiError,
    mediatype_from_content_type,
)
from services.automation_deps import DEFAULT_DEPS, AutomationDeps
from services.automation_rules import (
    business_timezone,
    flow_indexes,
    is_business_hours,
    matches_static_conditions,
    normalize_conditions,
    normalize_edges,
    normalize_flow_position,
    render_variables,
    unknown_variables,
    validate_graph_topology,
)
from services.notification_service import create_system_notification
from services.productivity_service import create_task, record_template_use
from services.ws_manager import manager

logger = logging.getLogger(__name__)
AUTOMATION_POLL_SECONDS = 10
MAX_ACTIONS = 10
# Cuántas ejecuciones vencidas corren en paralelo por ciclo del watcher.
MAX_CONCURRENT_EXECUTIONS = 5
# Veces máximas que una ejecución RUNNING puede recuperarse de quedar
# atascada (crash, reinicio del backend) antes de marcarla failed — no cuenta
# las reanudaciones normales de una pausa (wait/wait_any), solo las
# recuperaciones que hace _release_stale_executions.
MAX_EXECUTION_ATTEMPTS = 3
# Un flujo visual legítimo (varias llamadas a Evolution API de 30-60s) puede
# superar los 10 minutos; con menos margen se re-agendaría una ejecución viva.
STALE_EXECUTION_MINUTES = 15
# Cuando una regla alcanza su max_executions_per_hour, las ejecuciones que
# quedan afuera del cupo se re-agendan este tiempo después en vez de perderse.
RATE_LIMIT_RETRY_MINUTES = 10
# Las reglas de "sin responder" solo miran chats con actividad dentro de los
# minutos configurados más esta gracia (3 días): activar una regla no debe
# disparar contra todo el historial de conversaciones viejas.
OVERDUE_LOOKBACK_GRACE_MINUTES = 4320
TRIGGER_TYPES = frozenset(AutomationTrigger)
ACTION_TYPES = frozenset(AutomationActionType)
FLOW_NODE_TYPES = frozenset(FlowNodeType)
FLOW_CONDITION_TYPES = frozenset(FlowConditionType)
FLOW_HANDLES = frozenset(FlowHandle)
AUTOMATION_RECIPIENTS = frozenset(AutomationRecipient)
TASK_TYPES = frozenset(TaskType)
TASK_PRIORITIES = frozenset(TaskPriority)
MAX_FLOW_NODES = 50
MAX_FLOW_EDGES = 80
MAX_WHATSAPP_TEXT_LENGTH = 4096
MAX_REACTION_LENGTH = 16

# Los triggers de los routers lo activan para que watch_automations procese la
# cola de inmediato sin bloquear la request HTTP del usuario (una acción
# send_template puede tardar hasta 30s esperando a Evolution API).
_wake = asyncio.Event()

_render = render_variables
_unknown_variables = unknown_variables


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _wait_seconds(data: dict) -> int:
    """Segundos de espera de un nodo Wait. Con compatibilidad hacia atrás:
    los flujos publicados antes de dividir la espera en horas/minutos/
    segundos solo tienen "minutes" en su `flow_definition` guardada, y esa
    definición vieja no se reescribe sola — solo al volver a publicar."""
    seconds = data.get("seconds")
    if seconds is not None:
        return int(seconds)
    return int(data.get("minutes") or 0) * 60


def _rule_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "trigger_type": row["trigger_type"],
        "trigger_config": row["trigger_config"] or {},
        "conditions": row["conditions"] or {},
        "actions": row["actions"] or [],
        "builder_mode": row["builder_mode"] or AutomationBuilderMode.SIMPLE,
        "flow_definition": row["flow_definition"] or {},
        "published_flow_definition": row["published_flow_definition"],
        "flow_version": row["flow_version"] or 0,
        "delay_minutes": row["delay_minutes"],
        "max_executions_per_hour": row["max_executions_per_hour"],
        "is_active": row["is_active"],
        "visible_to_sellers": bool(row["visible_to_sellers"]),
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "execution_count": int(row["execution_count"] or 0),
        "last_execution_at": _ts(row["last_execution_at"]),
        "last_execution_status": row["last_execution_status"],
        "created_at": _ts(row["created_at"]),
        "updated_at": _ts(row["updated_at"]),
    }


def _execution_dict(row) -> dict:
    return {
        "id": row["id"],
        "rule_id": row["rule_id"],
        "rule_name": row["rule_name"],
        "rule_deleted": bool(row["rule_deleted"]),
        "lead_id": row["lead_id"],
        "lead_name": row["lead_name"],
        "trigger_type": row["trigger_type"],
        "status": row["status"],
        "scheduled_for": _ts(row["scheduled_for"]),
        "started_at": _ts(row["started_at"]),
        "finished_at": _ts(row["finished_at"]),
        "action_results": row["action_results"] or [],
        "flow_state": row["flow_state"] or {},
        "error": row["error"],
        "created_at": _ts(row["created_at"]),
        "start_source": row["start_source"] or "system",
        "started_by_user_id": row["started_by_user_id"],
    }


async def list_automation_rules() -> list[dict]:
    execution_count = (
        select(func.count(AutomationExecution.id))
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    last_execution_at = (
        select(AutomationExecution.created_at)
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        .limit(1)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    last_execution_status = (
        select(AutomationExecution.status)
        .where(AutomationExecution.rule_id == AutomationRule.id)
        .order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        .limit(1)
        .correlate(AutomationRule)
        .scalar_subquery()
    )
    stmt = select(
        AutomationRule.id,
        AutomationRule.name,
        AutomationRule.trigger_type,
        AutomationRule.trigger_config,
        AutomationRule.conditions,
        AutomationRule.actions,
        AutomationRule.builder_mode,
        AutomationRule.flow_definition,
        AutomationRule.published_flow_definition,
        AutomationRule.flow_version,
        AutomationRule.delay_minutes,
        AutomationRule.max_executions_per_hour,
        AutomationRule.is_active,
        AutomationRule.visible_to_sellers,
        AutomationRule.created_by_user_id,
        User.name.label("created_by_name"),
        execution_count.label("execution_count"),
        last_execution_at.label("last_execution_at"),
        last_execution_status.label("last_execution_status"),
        AutomationRule.created_at,
        AutomationRule.updated_at,
    ).join(User, User.id == AutomationRule.created_by_user_id).where(
        AutomationRule.deleted_at.is_(None)
    ).order_by(
        AutomationRule.is_active.desc(), AutomationRule.updated_at.desc()
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_rule_dict(row) for row in rows]


async def get_automation_rule(rule_id: int) -> dict | None:
    return next((rule for rule in await list_automation_rules() if rule["id"] == rule_id), None)


async def create_automation_rule(values: dict, user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        rule_id = (await session.execute(
            insert(AutomationRule).values(
                **values,
                created_by_user_id=user_id,
                created_at=now,
                updated_at=now,
            ).returning(AutomationRule.id)
        )).scalar_one()
        await session.commit()
    return await get_automation_rule(rule_id)


async def duplicate_automation_rule(rule_id: int, user_id: int) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None:
        return None
    is_visual = current["builder_mode"] == AutomationBuilderMode.VISUAL
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        new_id = (await session.execute(insert(AutomationRule).values(
            name=f"{current['name']} (copia)"[:120],
            trigger_type=current["trigger_type"],
            trigger_config=current["trigger_config"],
            conditions={} if is_visual else current["conditions"],
            actions=[] if is_visual else current["actions"],
            delay_minutes=0 if is_visual else current["delay_minutes"],
            max_executions_per_hour=current["max_executions_per_hour"],
            # Siempre arranca inactiva: evita tener dos reglas idénticas
            # corriendo a la vez sin que el usuario lo haya decidido. Por la
            # misma razón, nunca copia visible_to_sellers=True: el admin debe
            # decidir a propósito que la copia quede visible para vendedores.
            is_active=False,
            visible_to_sellers=False,
            builder_mode=current["builder_mode"],
            flow_definition=current["flow_definition"] if is_visual else {},
            published_flow_definition=None,
            flow_version=0,
            created_by_user_id=user_id,
            created_at=now,
            updated_at=now,
        ).returning(AutomationRule.id))).scalar_one()
        await session.commit()
    await manager.broadcast({"type": "automations_updated"})
    return await get_automation_rule(new_id)


async def update_automation_rule(rule_id: int, values: dict) -> dict | None:
    if values:
        values["updated_at"] = datetime.now(timezone.utc)
        async with get_sessionmaker()() as session:
            result = await session.execute(
                update(AutomationRule).where(
                    AutomationRule.id == rule_id,
                    AutomationRule.deleted_at.is_(None),
                ).values(**values)
            )
            await session.commit()
        if not result.rowcount:
            return None
    return await get_automation_rule(rule_id)


async def delete_automation_rule(rule_id: int) -> dict | None:
    """Oculta una regla sin destruir sus ejecuciones ni versiones auditables.

    Las ejecuciones programadas se cierran como omitidas. Una ejecución que ya
    está corriendo bloquea el borrado porque podría completar acciones después
    de que el usuario creyera eliminada la automatización.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        rule = (await session.execute(
            select(AutomationRule).where(
                AutomationRule.id == rule_id,
                AutomationRule.deleted_at.is_(None),
            ).with_for_update()
        )).scalar_one_or_none()
        if rule is None:
            return None
        active_executions = (await session.execute(select(
            AutomationExecution.id,
            AutomationExecution.status,
        ).where(
            AutomationExecution.rule_id == rule_id,
            AutomationExecution.status.in_([
                AutomationExecutionStatus.SCHEDULED,
                AutomationExecutionStatus.RUNNING,
            ]),
        ).with_for_update())).mappings().all()
        if any(row["status"] == AutomationExecutionStatus.RUNNING for row in active_executions):
            raise ValueError(
                "La automatización tiene una ejecución en curso. Cancélala o espera a que termine antes de eliminarla."
            )
        scheduled = await session.execute(update(AutomationExecution).where(
            AutomationExecution.rule_id == rule_id,
            AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
        ).values(
            status=AutomationExecutionStatus.SKIPPED,
            error="La automatización fue eliminada",
            finished_at=now,
        ))
        await session.execute(update(AutomationRule).where(
            AutomationRule.id == rule_id,
        ).values(is_active=False, deleted_at=now, updated_at=now))
        await session.commit()
    return {"id": rule_id, "cancelled_executions": scheduled.rowcount or 0}


async def list_automation_executions(
    rule_id: int | None = None,
    status: str | None = None,
    limit: int = 100,
    execution_id: int | None = None,
    exclude_skipped: bool = False,
    lead_id: str | None = None,
    start_source: str | None = None,
) -> list[dict]:
    stmt = select(
        AutomationExecution.id,
        AutomationExecution.rule_id,
        AutomationRule.name.label("rule_name"),
        AutomationRule.deleted_at.is_not(None).label("rule_deleted"),
        AutomationExecution.lead_id,
        Lead.nombre.label("lead_name"),
        AutomationExecution.trigger_type,
        AutomationExecution.status,
        AutomationExecution.scheduled_for,
        AutomationExecution.started_at,
        AutomationExecution.finished_at,
        AutomationExecution.action_results,
        AutomationExecution.flow_state,
        AutomationExecution.error,
        AutomationExecution.created_at,
        AutomationExecution.start_source,
        AutomationExecution.started_by_user_id,
    ).join(AutomationRule, AutomationRule.id == AutomationExecution.rule_id).outerjoin(
        Lead, Lead.id == AutomationExecution.lead_id
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationExecution.rule_id == rule_id)
    if status:
        stmt = stmt.where(AutomationExecution.status == status)
    elif exclude_skipped:
        stmt = stmt.where(AutomationExecution.status != AutomationExecutionStatus.SKIPPED)
    if execution_id is not None:
        stmt = stmt.where(AutomationExecution.id == execution_id)
    if lead_id is not None:
        stmt = stmt.where(AutomationExecution.lead_id == lead_id)
    if start_source is not None:
        stmt = stmt.where(AutomationExecution.start_source == start_source)
    stmt = stmt.order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc()).limit(limit)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_execution_dict(row) for row in rows]


async def get_automation_execution(execution_id: int) -> dict | None:
    rows = await list_automation_executions(execution_id=execution_id, limit=1)
    return rows[0] if rows else None


async def retry_automation_execution(execution_id: int) -> dict | None:
    """Reintenta una ejecución failed o skipped desde donde quedó — no repite
    acciones ya persistidas en action_results. Nunca aplica a completed: eso
    reiniciaría el flujo desde el disparador y reenviaría lo ya enviado.

    Resetea attempts a 0: es un reinicio explícito del usuario, no debería
    heredar el contador de recuperaciones automáticas agotado que la llevó a
    failed (si no, una ejecución que se vuelve a atascar moriría en el primer
    ciclo de _release_stale_executions sin darle ninguna chance)."""
    async with get_sessionmaker()() as session:
        execution = await session.get(AutomationExecution, execution_id)
        if execution is None or execution.status not in {
            AutomationExecutionStatus.FAILED, AutomationExecutionStatus.SKIPPED,
        }:
            return None
        rule = await session.get(AutomationRule, execution.rule_id)
        if rule is None or rule.deleted_at is not None or not rule.is_active:
            return None
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.status.in_([
                AutomationExecutionStatus.FAILED, AutomationExecutionStatus.SKIPPED,
            ]),
        ).values(
            status=AutomationExecutionStatus.SCHEDULED,
            scheduled_for=datetime.now(timezone.utc),
            started_at=None,
            finished_at=None,
            error=None,
            attempts=0,
        ))
        await session.commit()
    if not result.rowcount:
        return None
    await manager.broadcast({"type": "automations_updated"})
    _wake.set()
    return await get_automation_execution(execution_id)


async def cancel_scheduled_system_executions(lead_id: str) -> int:
    """Al pausar la automatización de un lead, cancela lo que quedó
    programado (con delay) de disparadores de sistema — no toca lo que ya
    está corriendo (`_action_*` en curso no se interrumpe a mitad de envío,
    mismo criterio que `delete_automation_rule`) ni los flujos manuales del
    vendedor (`start_source == "manual"`), que el vendedor pidió a propósito."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.lead_id == lead_id,
            AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            AutomationExecution.start_source != "manual",
        ).values(
            status=AutomationExecutionStatus.SKIPPED,
            error="Automatización pausada para este chat",
            finished_at=now,
        ))
        await session.commit()
    if result.rowcount:
        await manager.broadcast({"type": "automations_updated"})
    return result.rowcount or 0


async def cancel_automation_execution(execution_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        result = await session.execute(update(AutomationExecution).where(
            AutomationExecution.id == execution_id,
            AutomationExecution.status.in_([
                AutomationExecutionStatus.SCHEDULED, AutomationExecutionStatus.RUNNING,
            ]),
        ).values(
            status=AutomationExecutionStatus.SKIPPED,
            error="Cancelada manualmente",
            finished_at=datetime.now(timezone.utc),
        ))
        await session.commit()
    if not result.rowcount:
        return None
    await manager.broadcast({"type": "automations_updated"})
    return await get_automation_execution(execution_id)


_normalize_automation_conditions = normalize_conditions


async def validate_automation_rule(values: dict, *, max_actions: int = MAX_ACTIONS) -> dict:
    name = str(values.get("name") or "").strip()
    if not name or len(name) > 120:
        raise ValueError("El nombre debe tener entre 1 y 120 caracteres")
    trigger_type = values.get("trigger_type")
    if trigger_type not in TRIGGER_TYPES:
        raise ValueError("Disparador no soportado")
    trigger_config = values.get("trigger_config") if isinstance(values.get("trigger_config"), dict) else {}
    if trigger_type in {
        AutomationTrigger.SELLER_RESPONSE_OVERDUE,
        AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
    }:
        minutes = int(trigger_config.get("minutes") or 0)
        if not 1 <= minutes <= 43200:
            raise ValueError("La demora debe estar entre 1 minuto y 30 días")
        trigger_config = {"minutes": minutes}
    else:
        trigger_config = {}

    normalized_conditions = _normalize_automation_conditions(values.get("conditions"))

    actions = values.get("actions") if isinstance(values.get("actions"), list) else []
    if not 1 <= len(actions) <= max_actions:
        raise ValueError(f"Configura entre 1 y {max_actions} acciones")
    normalized_actions: list[dict] = []
    referenced_users: set[int] = set()
    referenced_tags: set[int] = set()
    referenced_templates: set[int] = set()
    referenced_media_assets: set[int] = set()
    for position, raw in enumerate(actions, start=1):
        if not isinstance(raw, dict) or raw.get("type") not in ACTION_TYPES:
            raise ValueError(f"Acción {position}: tipo no soportado")
        action_type = raw["type"]
        if action_type == AutomationActionType.CREATE_TASK:
            title = str(raw.get("title") or "").strip()
            due_minutes = int(raw.get("due_minutes") or 0)
            remind_before = int(raw.get("remind_minutes_before") or 0)
            if not title or len(title) > 160 or not 1 <= due_minutes <= 43200:
                raise ValueError(f"Acción {position}: título y vencimiento de tarea inválidos")
            if remind_before < 0 or remind_before >= due_minutes:
                raise ValueError(f"Acción {position}: el recordatorio debe ser anterior al vencimiento")
            assignee = int(raw["assigned_user_id"]) if raw.get("assigned_user_id") else None
            if assignee:
                referenced_users.add(assignee)
            normalized_actions.append({
                "type": action_type,
                "title": title,
                "description": str(raw.get("description") or "").strip()[:1000] or None,
                "task_type": raw.get("task_type") if raw.get("task_type") in TASK_TYPES else TaskType.FOLLOW_UP,
                "priority": raw.get("priority") if raw.get("priority") in TASK_PRIORITIES else TaskPriority.NORMAL,
                "due_minutes": due_minutes,
                "remind_minutes_before": remind_before,
                "assigned_user_id": assignee,
            })
        elif action_type == AutomationActionType.ASSIGN_SELLER:
            user_id = int(raw.get("user_id") or 0)
            if not user_id:
                raise ValueError(f"Acción {position}: selecciona un vendedor")
            referenced_users.add(user_id)
            normalized_actions.append({"type": action_type, "user_id": user_id})
        elif action_type in {AutomationActionType.ADD_TAG, AutomationActionType.REMOVE_TAG}:
            tag_id = int(raw.get("tag_id") or 0)
            if not tag_id:
                raise ValueError(f"Acción {position}: selecciona una etiqueta")
            referenced_tags.add(tag_id)
            normalized_actions.append({"type": action_type, "tag_id": tag_id})
        elif action_type == AutomationActionType.CHANGE_STAGE:
            stage = str(raw.get("stage") or "")
            if stage not in {item.value for item in LeadStage}:
                raise ValueError(f"Acción {position}: etapa inválida")
            normalized_actions.append({"type": action_type, "stage": stage})
        elif action_type == AutomationActionType.NOTIFY:
            title = str(raw.get("title") or "").strip()
            body = str(raw.get("body") or "").strip()
            recipient = (
                raw.get("recipient")
                if raw.get("recipient") in AUTOMATION_RECIPIENTS
                else AutomationRecipient.SELLER
            )
            user_id = (
                int(raw.get("user_id") or 0)
                if recipient == AutomationRecipient.SPECIFIC
                else None
            )
            if not title or not body or len(title) > 160 or len(body) > 1000:
                raise ValueError(f"Acción {position}: título o contenido de notificación inválido")
            if recipient == AutomationRecipient.SPECIFIC and not user_id:
                raise ValueError(f"Acción {position}: selecciona el destinatario")
            if user_id:
                referenced_users.add(user_id)
            normalized_actions.append({
                "type": action_type, "recipient": recipient, "user_id": user_id,
                "title": title, "body": body,
            })
        elif action_type == AutomationActionType.SEND_TEMPLATE:
            template_id = int(raw.get("template_id") or 0)
            if not template_id:
                raise ValueError(f"Acción {position}: selecciona una plantilla")
            referenced_templates.add(template_id)
            normalized_actions.append({"type": action_type, "template_id": template_id})
        elif action_type == AutomationActionType.SEND_MESSAGE:
            text = str(raw.get("text") or "").strip()
            if not text:
                raise ValueError(f"Acción {position}: escribe el mensaje a enviar")
            if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
                raise ValueError(f"Acción {position}: el mensaje admite máximo {MAX_WHATSAPP_TEXT_LENGTH} caracteres")
            normalized_actions.append({"type": action_type, "text": text})
        elif action_type == AutomationActionType.REACT_TO_LAST_CUSTOMER_MESSAGE:
            emoji = str(raw.get("emoji") or "").strip()
            if not emoji or len(emoji) > MAX_REACTION_LENGTH:
                raise ValueError(f"Acción {position}: selecciona una reacción válida")
            normalized_actions.append({"type": action_type, "emoji": emoji})
        elif action_type == AutomationActionType.CHANGE_SERVICE:
            # Vacío es válido — significa quitar el servicio de interés
            # actual, no un error de formulario.
            service = str(raw.get("service") or "").strip()[:160] or None
            normalized_actions.append({"type": action_type, "service": service})
        else:
            # SEND_AUDIO, SEND_ATTACHMENT
            media_asset_id = int(raw.get("media_asset_id") or 0)
            if not media_asset_id:
                raise ValueError(f"Acción {position}: selecciona un archivo de la librería de medios")
            referenced_media_assets.add(media_asset_id)
            normalized_actions.append({"type": action_type, "media_asset_id": media_asset_id})

    for position, action in enumerate(normalized_actions, start=1):
        unknown = set().union(*(
            _unknown_variables(value)
            for value in action.values()
            if isinstance(value, str)
        ))
        if unknown:
            names = ", ".join(f"{{{{{name}}}}}" for name in sorted(unknown))
            raise ValueError(f"Acción {position}: variables no reconocidas: {names}")

    if normalized_conditions["seller_id"]:
        referenced_users.add(normalized_conditions["seller_id"])
    if normalized_conditions["tag_id"]:
        referenced_tags.add(normalized_conditions["tag_id"])
    async with get_sessionmaker()() as session:
        if referenced_users:
            found = set((await session.execute(
                select(User.id).where(User.id.in_(referenced_users), User.is_active.is_(True))
            )).scalars().all())
            if found != referenced_users:
                raise ValueError("Algún usuario seleccionado no existe o está inactivo")
        if referenced_tags:
            found = set((await session.execute(
                select(LeadTag.id).where(LeadTag.id.in_(referenced_tags), LeadTag.is_active.is_(True))
            )).scalars().all())
            if found != referenced_tags:
                raise ValueError("Alguna etiqueta seleccionada no existe o está inactiva")
        if referenced_templates:
            templates = (await session.execute(
                select(MessageTemplate).where(MessageTemplate.id.in_(referenced_templates))
            )).scalars().all()
            valid_ids = {
                template.id for template in templates
                if template.is_active
                and template.template_type == "internal"
                and template.interactive_type == "none"
            }
            if valid_ids != referenced_templates:
                raise ValueError("El envío automático solo admite plantillas internas activas (sin botones/listas)")
        if referenced_media_assets:
            found = set((await session.execute(
                select(MediaAsset.id).where(MediaAsset.id.in_(referenced_media_assets))
            )).scalars().all())
            if found != referenced_media_assets:
                raise ValueError("Algún archivo de la librería de medios ya no existe")

    max_per_hour = values.get("max_executions_per_hour")
    if max_per_hour is not None and not 1 <= int(max_per_hour) <= 1000:
        raise ValueError("El límite por hora debe estar entre 1 y 1000")

    return {
        "name": name,
        "trigger_type": trigger_type,
        "trigger_config": trigger_config,
        "conditions": normalized_conditions,
        "actions": normalized_actions,
        "delay_minutes": int(values.get("delay_minutes") or 0),
        "max_executions_per_hour": int(max_per_hour) if max_per_hour else None,
        "is_active": bool(values.get("is_active", True)),
        "visible_to_sellers": bool(values.get("visible_to_sellers", False)),
    }


_normalize_flow_position = normalize_flow_position


def _normalize_wait_any_conditions(data: dict, position: int) -> dict:
    """Condiciones de un bloque Pausa (`wait_any`): cada una es una salida
    propia del nodo. El `id` de cada condición es directamente su `kind`
    ("timer"/"message") porque el diseño admite a lo sumo una de cada — no
    hace falta que el usuario invente identificadores.

    `timer` es obligatorio (nunca puede quedar esperando para siempre);
    `message` es opcional.
    """
    raw_conditions = data.get("conditions")
    if not isinstance(raw_conditions, list) or not raw_conditions:
        raise ValueError(f"Pausa {position}: configura al menos una condición")
    kinds_seen: set[str] = set()
    conditions: list[dict] = []
    for raw in raw_conditions:
        kind = raw.get("kind") if isinstance(raw, dict) else None
        if kind not in set(WaitAnyConditionKind):
            raise ValueError(f"Pausa {position}: condición inválida")
        if kind in kinds_seen:
            raise ValueError(f"Pausa {position}: no repitas el mismo tipo de condición")
        kinds_seen.add(kind)
        if kind == WaitAnyConditionKind.TIMER:
            seconds = int(raw.get("seconds") or 0)
            if not 1 <= seconds <= 604800:
                raise ValueError(f"Pausa {position}: el temporizador debe estar entre 1 segundo y 7 días")
            conditions.append({"id": kind, "kind": kind, "seconds": seconds})
        else:
            conditions.append({"id": kind, "kind": kind})
    if WaitAnyConditionKind.TIMER not in kinds_seen:
        raise ValueError(
            f"Pausa {position}: agrega un temporizador — es obligatorio, para que la "
            "ejecución nunca quede esperando para siempre"
        )
    return {"conditions": conditions}


MAX_QUESTION_BUTTONS = 3


def _question_button_label(raw_button: object) -> str:
    """Un botón llega como string simple o como `{id, label}` — el editor
    visual siempre manda esto último para poder asignarle un id estable al
    handle del grafo."""
    if isinstance(raw_button, dict):
        return str(raw_button.get("label") or "").strip()[:20]
    if isinstance(raw_button, str):
        return raw_button.strip()[:20]
    return ""


def _normalize_question(data: dict, position: int) -> dict:
    """Bloque Pregunta (`question`): manda un mensaje con hasta 3 botones y
    ramifica según cuál tocó el cliente. `id` de cada botón es `btn_1..btn_n`
    (mismo esquema que ya usaba la acción `send_buttons` que este nodo
    reemplaza) — son, junto con `other` (otra respuesta) y `timeout` (no
    contestó a tiempo), los handles de salida del nodo."""
    text = str(data.get("text") or "").strip()
    if not text:
        raise ValueError(f"Pregunta {position}: escribe el mensaje")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise ValueError(f"Pregunta {position}: el mensaje admite máximo {MAX_WHATSAPP_TEXT_LENGTH} caracteres")
    raw_buttons = data.get("buttons")
    labels = [
        label for label in (
            _question_button_label(raw_button)
            for raw_button in (raw_buttons if isinstance(raw_buttons, list) else [])
        )
        if label
    ]
    if not 1 <= len(labels) <= MAX_QUESTION_BUTTONS:
        raise ValueError(f"Pregunta {position}: configura entre 1 y {MAX_QUESTION_BUTTONS} botones")
    timeout_seconds = int(data.get("timeout_seconds") or 0)
    if not 1 <= timeout_seconds <= 604800:
        raise ValueError(f"Pregunta {position}: el tiempo de espera debe estar entre 1 segundo y 7 días")
    buttons = [{"id": f"btn_{index}", "label": label} for index, label in enumerate(labels, start=1)]
    return {"text": text, "buttons": buttons, "timeout_seconds": timeout_seconds}


def _normalize_flow_condition(data: dict, position: int) -> tuple[dict, int | None, int | None]:
    condition_type = str(data.get("condition_type") or "")
    if condition_type not in FLOW_CONDITION_TYPES:
        raise ValueError(f"Condición {position}: tipo no soportado")
    value = data.get("value")
    user_id = None
    tag_id = None
    if condition_type == FlowConditionType.STAGE_EQUALS:
        value = str(value or "")
        if value not in {stage.value for stage in LeadStage}:
            raise ValueError(f"Condición {position}: etapa inválida")
    elif condition_type in {
        FlowConditionType.ORIGIN_CONTAINS,
        FlowConditionType.SERVICE_CONTAINS,
    }:
        value = str(value or "").strip()
        if not value or len(value) > 120:
            raise ValueError(f"Condición {position}: escribe un valor de hasta 120 caracteres")
    elif condition_type == FlowConditionType.SELLER_EQUALS:
        user_id = int(value or 0)
        if not user_id:
            raise ValueError(f"Condición {position}: selecciona un vendedor")
        value = user_id
    elif condition_type == FlowConditionType.TAG_PRESENT:
        tag_id = int(value or 0)
        if not tag_id:
            raise ValueError(f"Condición {position}: selecciona una etiqueta")
        value = tag_id
    else:
        value = True
    return {"condition_type": condition_type, "value": value}, user_id, tag_id


def normalize_visual_draft(name: str, definition: dict) -> dict:
    name = str(name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("El nombre debe tener entre 1 y 120 caracteres")
    if not isinstance(definition, dict):
        raise ValueError("La definición del flujo no es válida")
    conditions = _normalize_automation_conditions(definition.get("conditions"))
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not 1 <= len(raw_nodes) <= MAX_FLOW_NODES:
        raise ValueError(f"El borrador debe tener entre 1 y {MAX_FLOW_NODES} bloques")
    if not isinstance(raw_edges, list) or len(raw_edges) > MAX_FLOW_EDGES:
        raise ValueError(f"El borrador admite hasta {MAX_FLOW_EDGES} conexiones")
    nodes: list[dict] = []
    ids: set[str] = set()
    for position, raw_node in enumerate(raw_nodes, start=1):
        if not isinstance(raw_node, dict):
            raise ValueError(f"Bloque {position}: formato inválido")
        node_id = str(raw_node.get("id") or "").strip()[:80]
        node_type = str(raw_node.get("type") or "")
        if not node_id or node_id in ids:
            raise ValueError(f"Bloque {position}: identificador vacío o duplicado")
        if node_type not in FLOW_NODE_TYPES:
            raise ValueError(f"Bloque {position}: tipo no soportado")
        ids.add(node_id)
        nodes.append({
            "id": node_id, "type": node_type,
            "position": _normalize_flow_position(raw_node.get("position")),
            "data": raw_node.get("data") if isinstance(raw_node.get("data"), dict) else {},
        })
    # Los bloques Pausa (wait_any) usan como handle el "kind" de cada
    # condición ("timer"/"message"/...) y Pregunta (question) usa
    # "btn_1".."btn_n" + "other" + "timeout" — ninguno está en el enum fijo
    # FlowHandle. Se admiten acá para que el borrador se pueda guardar
    # mientras se arma (autosave), sin bloquear por una conexión que la
    # validación estricta de validate_graph_topology recién exige al publicar.
    dynamic_handles = {
        condition["kind"]
        for node in nodes if node["type"] == FlowNodeType.WAIT_ANY
        for condition in (node["data"].get("conditions") or [])
        if isinstance(condition, dict) and isinstance(condition.get("kind"), str)
    }
    dynamic_handles |= {
        button["id"]
        for node in nodes if node["type"] == FlowNodeType.QUESTION
        for button in (node["data"].get("buttons") or [])
        if isinstance(button, dict) and isinstance(button.get("id"), str)
    }
    if any(node["type"] == FlowNodeType.QUESTION for node in nodes):
        dynamic_handles |= {QuestionHandle.OTHER, QuestionHandle.TIMEOUT}
    edges = normalize_edges(raw_edges, ids, allow_duplicate_handles=False, extra_handles=dynamic_handles)
    trigger = next((node for node in nodes if node["type"] == FlowNodeType.TRIGGER), None)
    trigger_data = trigger["data"] if trigger else {}
    trigger_type = (
        trigger_data.get("trigger_type")
        if trigger_data.get("trigger_type") in TRIGGER_TYPES
        else AutomationTrigger.LEAD_CREATED
    )
    trigger_config = {}
    if trigger_type in {
        AutomationTrigger.SELLER_RESPONSE_OVERDUE,
        AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
    }:
        minutes = int(trigger_data.get("minutes") or 30)
        trigger_config = {"minutes": max(1, min(43200, minutes))}
    return {
        "name": name, "trigger_type": trigger_type, "trigger_config": trigger_config,
        "conditions": conditions,
        "flow_definition": {"conditions": conditions, "nodes": nodes, "edges": edges},
    }


async def validate_visual_flow(name: str, definition: dict) -> dict:
    name = str(name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("El nombre debe tener entre 1 y 120 caracteres")
    if not isinstance(definition, dict):
        raise ValueError("La definición del flujo no es válida")
    raw_conditions = definition.get("conditions")
    raw_nodes = definition.get("nodes")
    raw_edges = definition.get("edges")
    if not isinstance(raw_nodes, list) or not 2 <= len(raw_nodes) <= MAX_FLOW_NODES:
        raise ValueError(f"El flujo debe tener entre 2 y {MAX_FLOW_NODES} bloques")
    if not isinstance(raw_edges, list) or len(raw_edges) > MAX_FLOW_EDGES:
        raise ValueError(f"El flujo admite hasta {MAX_FLOW_EDGES} conexiones")

    ids: set[str] = set()
    normalized_nodes: list[dict] = []
    action_nodes: list[tuple[int, dict]] = []
    condition_users: set[int] = set()
    condition_tags: set[int] = set()
    trigger_nodes: list[dict] = []
    end_count = 0
    for position, raw_node in enumerate(raw_nodes, start=1):
        if not isinstance(raw_node, dict):
            raise ValueError(f"Bloque {position}: formato inválido")
        node_id = str(raw_node.get("id") or "").strip()[:80]
        node_type = str(raw_node.get("type") or "")
        data = raw_node.get("data") if isinstance(raw_node.get("data"), dict) else {}
        if not node_id or node_id in ids:
            raise ValueError(f"Bloque {position}: identificador vacío o duplicado")
        if node_type not in FLOW_NODE_TYPES:
            raise ValueError(f"Bloque {position}: tipo no soportado")
        ids.add(node_id)
        normalized_data: dict
        if node_type == FlowNodeType.TRIGGER:
            trigger_type = data.get("trigger_type")
            trigger_config = (
                {"minutes": data.get("minutes")}
                if trigger_type in {
                    AutomationTrigger.SELLER_RESPONSE_OVERDUE,
                    AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
                }
                else {}
            )
            trigger_values = await validate_automation_rule({
                "name": name, "trigger_type": trigger_type, "trigger_config": trigger_config,
                "conditions": {},
                "actions": [{"type": AutomationActionType.CHANGE_STAGE, "stage": "nuevo"}],
                "delay_minutes": 0, "is_active": False,
            })
            normalized_data = {
                "trigger_type": trigger_values["trigger_type"],
                "minutes": trigger_values["trigger_config"].get("minutes"),
            }
            trigger_nodes.append({"id": node_id, "data": normalized_data})
        elif node_type == FlowNodeType.CONDITION:
            normalized_data, user_id, tag_id = _normalize_flow_condition(data, position)
            if user_id:
                condition_users.add(user_id)
            if tag_id:
                condition_tags.add(tag_id)
        elif node_type == FlowNodeType.ACTION:
            action = data.get("action") if isinstance(data.get("action"), dict) else {}
            normalized_data = {"action": action}
            action_nodes.append((len(normalized_nodes), action))
        elif node_type == FlowNodeType.WAIT:
            seconds = _wait_seconds(data)
            if not 1 <= seconds <= 604800:
                raise ValueError(f"Espera {position}: configura entre 1 segundo y 7 días")
            normalized_data = {"seconds": seconds}
        elif node_type == FlowNodeType.WAIT_ANY:
            normalized_data = _normalize_wait_any_conditions(data, position)
        elif node_type == FlowNodeType.QUESTION:
            normalized_data = _normalize_question(data, position)
        else:
            end_count += 1
            normalized_data = {"label": str(data.get("label") or "Fin").strip()[:80] or "Fin"}
        normalized_nodes.append({
            "id": node_id,
            "type": node_type,
            "position": _normalize_flow_position(raw_node.get("position")),
            "data": normalized_data,
        })

    if len(trigger_nodes) != 1:
        raise ValueError("El flujo debe tener exactamente un disparador")
    if not end_count:
        raise ValueError("El flujo debe tener al menos un bloque Fin")
    if not action_nodes:
        raise ValueError("El flujo debe tener al menos una acción")

    # MAX_ACTIONS (10) es el tope del modo simple, una lista plana y
    # secuencial. Acá sumamos los bloques Acción de TODAS las ramas del
    # grafo aunque una ejecución nunca recorra más de una, así que se acota
    # por MAX_FLOW_NODES (el tope estructural del flujo) en vez de MAX_ACTIONS.
    normalized_action_values = await validate_automation_rule({
        "name": name,
        "trigger_type": trigger_nodes[0]["data"]["trigger_type"],
        "trigger_config": {"minutes": trigger_nodes[0]["data"].get("minutes")},
        "conditions": raw_conditions,
        "actions": [action for _, action in action_nodes],
        "delay_minutes": 0,
        "is_active": False,
    }, max_actions=MAX_FLOW_NODES)
    for (node_index, _), normalized_action in zip(action_nodes, normalized_action_values["actions"]):
        normalized_nodes[node_index]["data"]["action"] = normalized_action

    async with get_sessionmaker()() as session:
        if condition_users:
            found = set((await session.execute(select(User.id).where(
                User.id.in_(condition_users), User.is_active.is_(True)
            ))).scalars().all())
            if found != condition_users:
                raise ValueError("Algún vendedor usado en una condición no existe o está inactivo")
        if condition_tags:
            found = set((await session.execute(select(LeadTag.id).where(
                LeadTag.id.in_(condition_tags), LeadTag.is_active.is_(True)
            ))).scalars().all())
            if found != condition_tags:
                raise ValueError("Alguna etiqueta usada en una condición no existe o está inactiva")

    normalized_edges = normalize_edges(raw_edges, ids)
    validate_graph_topology(normalized_nodes, normalized_edges, trigger_nodes[0]["id"])

    return {
        "name": name,
        "trigger_type": trigger_nodes[0]["data"]["trigger_type"],
        "trigger_config": normalized_action_values["trigger_config"],
        "conditions": normalized_action_values["conditions"],
        "flow_definition": {
            "conditions": normalized_action_values["conditions"],
            "nodes": normalized_nodes,
            "edges": normalized_edges,
        },
    }


async def create_visual_flow(name: str, definition: dict, user_id: int) -> dict:
    validated = normalize_visual_draft(name, definition)
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        rule_id = (await session.execute(insert(AutomationRule).values(
            name=validated["name"],
            trigger_type=validated["trigger_type"],
            trigger_config=validated["trigger_config"],
            conditions={}, actions=[], delay_minutes=0, is_active=False,
            builder_mode=AutomationBuilderMode.VISUAL,
            flow_definition=validated["flow_definition"],
            published_flow_definition=None, flow_version=0,
            created_by_user_id=user_id, created_at=now, updated_at=now,
        ).returning(AutomationRule.id))).scalar_one()
        await session.commit()
    return await get_automation_rule(rule_id)


async def save_visual_flow(rule_id: int, name: str, definition: dict) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return None
    validated = normalize_visual_draft(name, definition)
    return await update_automation_rule(rule_id, {
        "name": validated["name"],
        "flow_definition": validated["flow_definition"],
    })


async def publish_visual_flow(rule_id: int) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return None
    validated = await validate_visual_flow(current["name"], current["flow_definition"])
    now = datetime.now(timezone.utc)
    new_version = current["flow_version"] + 1
    async with get_sessionmaker()() as session:
        await session.execute(update(AutomationRule).where(AutomationRule.id == rule_id).values(
            name=validated["name"],
            trigger_type=validated["trigger_type"],
            trigger_config=validated["trigger_config"],
            conditions=validated["conditions"],
            flow_definition=validated["flow_definition"],
            published_flow_definition=validated["flow_definition"],
            flow_version=new_version,
            is_active=True,
            updated_at=now,
        ))
        await session.execute(pg_insert(AutomationFlowVersion).values(
            rule_id=rule_id,
            version=new_version,
            definition=validated["flow_definition"],
            created_at=now,
        ).on_conflict_do_nothing(
            index_elements=[AutomationFlowVersion.rule_id, AutomationFlowVersion.version]
        ))
        await session.commit()
    return await get_automation_rule(rule_id)


async def list_flow_versions(rule_id: int) -> list[dict]:
    """Versiones publicadas de un flujo visual, de la más nueva a la más vieja."""
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return []
    stmt = select(
        AutomationFlowVersion.version,
        AutomationFlowVersion.definition,
        AutomationFlowVersion.created_at,
    ).where(AutomationFlowVersion.rule_id == rule_id).order_by(AutomationFlowVersion.version.desc())
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {
            "version": row["version"],
            "created_at": _ts(row["created_at"]),
            "node_count": len((row["definition"] or {}).get("nodes") or []),
            "edge_count": len((row["definition"] or {}).get("edges") or []),
            "is_current": row["version"] == current["flow_version"],
        }
        for row in rows
    ]


async def restore_flow_version(rule_id: int, version: int) -> dict | None:
    """Carga una versión publicada como borrador.

    No republica ni reactiva: deja el flujo listo para revisar y, si convence,
    publicar. Así restaurar nunca cambia por sí solo lo que se está ejecutando.
    """
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        return None
    async with get_sessionmaker()() as session:
        definition = await session.scalar(select(AutomationFlowVersion.definition).where(
            AutomationFlowVersion.rule_id == rule_id,
            AutomationFlowVersion.version == version,
        ))
    if not definition:
        return None
    validated = normalize_visual_draft(current["name"], definition)
    return await update_automation_rule(rule_id, {"flow_definition": validated["flow_definition"]})


async def schedule_automation_event(
    trigger_type: AutomationTrigger,
    lead_id: str,
    event_key: str,
    payload: dict | None = None,
    rule_id: int | None = None,
    started_by_user_id: int | None = None,
    start_source: str = "system",
) -> int:
    if trigger_type not in TRIGGER_TYPES:
        return 0
    stmt = select(
        AutomationRule.id, AutomationRule.delay_minutes, AutomationRule.builder_mode,
        AutomationRule.flow_version,
    ).where(
        AutomationRule.is_active.is_(True), AutomationRule.trigger_type == trigger_type
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationRule.id == rule_id)
    async with get_sessionmaker()() as session:
        lead = await session.get(Lead, lead_id)
        if lead is None:
            # debug y no warning: el watcher redescubre mensajes de chats sin
            # lead cada ciclo y un warning por chat cada 10s inunda el log.
            logger.debug("Evento de automatización ignorado: lead %s no existe", lead_id)
            return 0
        # La pausa solo corta los triggers de sistema (lead_created,
        # stage_changed, message_received, *_overdue, task_due...). Un flujo
        # manual (start_source == "manual", el vendedor tocó "Iniciar flujo")
        # se respeta igual: lo pidió a propósito.
        if lead.automatizacion_pausada and start_source == "system":
            logger.debug("Evento de automatización ignorado: %s tiene la automatización pausada", lead_id)
            return 0
        rules = (await session.execute(stmt)).mappings().all()
        now = datetime.now(timezone.utc)
        created = 0
        for rule in rules:
            result = await session.execute(
                pg_insert(AutomationExecution).values(
                    rule_id=rule["id"],
                    lead_id=lead_id,
                    trigger_type=trigger_type,
                    event_key=event_key,
                    event_payload=payload or {},
                    status=AutomationExecutionStatus.SCHEDULED,
                    scheduled_for=now + timedelta(minutes=rule["delay_minutes"]),
                    action_results=[],
                    flow_state={
                        "flow_version": rule["flow_version"],
                        "current_node_id": None,
                        "path": [],
                    }
                    if rule["builder_mode"] == AutomationBuilderMode.VISUAL
                    else {},
                    created_at=now,
                    start_source=start_source,
                    started_by_user_id=started_by_user_id,
                ).on_conflict_do_nothing(
                    index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key]
                )
            )
            created += result.rowcount
        await session.commit()
    if created:
        await manager.broadcast({"type": "automations_updated"})
    return created


async def list_manual_flows(is_admin: bool) -> list[dict]:
    """Flujos visuales con trigger manual que puede disparar un vendedor desde
    el chat de un lead. El admin además ve los que todavía no marcó visibles
    (para poder probarlos) o que siguen sin publicar/activar."""
    rules = await list_automation_rules()
    return [
        rule for rule in rules
        if rule["builder_mode"] == AutomationBuilderMode.VISUAL
        and rule["trigger_type"] == AutomationTrigger.MANUAL
        and (is_admin or (rule["visible_to_sellers"] and rule["is_active"]))
    ]


async def start_manual_flow_execution(
    rule_id: int, lead_id: str, started_by_user_id: int, is_admin: bool,
) -> dict:
    """Arranca, con un click del vendedor, una ejecución de un flujo visual de
    trigger manual sobre un lead puntual.

    A diferencia de los triggers de sistema (que dedupan por event_key fijo:
    un lead solo entra una vez por lead_created, stage_changed, etc.), acá el
    vendedor debe poder repetir el mismo flujo sobre el mismo lead una vez que
    la ejecución anterior terminó — por eso la event_key lleva un uuid único
    por click en vez de derivarse del lead o del evento, y nunca choca con el
    índice único (rule_id, event_key). Lo que sí impide una segunda ejecución
    en curso es el índice único parcial (rule_id, lead_id) sobre ejecuciones
    manuales no terminales (ver migración b3d8f5c1a927): un doble click, dos
    vendedores, o un refresh accidental chocan contra él y ese conflicto se
    traduce acá abajo en un mensaje claro en vez de propagarse como un 500.
    """
    rule = await get_automation_rule(rule_id)
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
    except IntegrityError as exc:
        raise ValueError(
            "Ya hay una ejecución de este flujo en curso para este lead. "
            "Esperá a que termine o cancelala antes de iniciar otra."
        ) from exc
    if not created:
        raise ValueError("No se pudo iniciar el flujo: verifica que el lead exista")
    _wake.set()

    async with get_sessionmaker()() as session:
        execution_id = await session.scalar(
            select(AutomationExecution.id).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.event_key == event_key,
            )
        )
    execution = await get_automation_execution(execution_id) if execution_id else None
    if execution is None:
        raise ValueError("No se pudo recuperar la ejecución iniciada")
    return execution


async def trigger_lead_created(lead_id: str) -> None:
    async with get_sessionmaker()() as session:
        activity_id = await session.scalar(
            select(LeadActivity.id).where(
                LeadActivity.lead_id == lead_id,
                LeadActivity.event_type == AutomationTrigger.LEAD_CREATED,
            ).order_by(LeadActivity.id.desc()).limit(1)
        )
    await schedule_automation_event(
        AutomationTrigger.LEAD_CREATED,
        lead_id,
        f"lead:{activity_id or lead_id}",
    )
    _wake.set()


async def trigger_stage_changed(lead_id: str) -> None:
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(LeadActivity.id, LeadActivity.old_value, LeadActivity.new_value).where(
                LeadActivity.lead_id == lead_id,
                LeadActivity.event_type == AutomationTrigger.STAGE_CHANGED,
            ).order_by(LeadActivity.id.desc()).limit(1)
        )).mappings().first()
    if row:
        await schedule_automation_event(
            AutomationTrigger.STAGE_CHANGED,
            lead_id,
            f"stage:{row['id']}",
            {"old_value": row["old_value"], "new_value": row["new_value"]},
        )
        _wake.set()


async def trigger_inbound_message(message: dict) -> None:
    if message.get("sender") != "cliente" or not message.get("chat_id"):
        return
    lead_id = message["chat_id"]
    message_key = str(message.get("message_id") or "")
    if not message_key:
        return
    await schedule_automation_event(
        AutomationTrigger.MESSAGE_RECEIVED,
        lead_id,
        f"message:{message_key}",
        {"message_id": message_key, "content": message.get("content")},
    )
    async with get_sessionmaker()() as session:
        message_count = await session.scalar(
            select(func.count(WspMessage.id)).where(WspMessage.chat_id == lead_id)
        )
        has_recorded_creation = await session.scalar(
            select(LeadActivity.id).where(
                LeadActivity.lead_id == lead_id,
                LeadActivity.event_type == AutomationTrigger.LEAD_CREATED,
            ).limit(1)
        )
    if message_count == 1 and not has_recorded_creation:
        await schedule_automation_event(
            AutomationTrigger.LEAD_CREATED,
            lead_id,
            f"lead:first-message:{message_key}",
            {"source": "first_inbound_message"},
        )
    _wake.set()


async def _cooldown_blocked(rule_id: int, chat_id: str, minutes: int, deps: AutomationDeps) -> bool:
    """La ejecución en curso todavía está en running/scheduled, nunca en
    completed, así que no hace falta excluirla para que no se bloquee a sí
    misma."""
    cutoff = deps.now() - timedelta(minutes=minutes)
    async with deps.session() as session:
        recent = await session.scalar(
            select(AutomationExecution.id).where(
                AutomationExecution.rule_id == rule_id,
                AutomationExecution.lead_id == chat_id,
                AutomationExecution.status == AutomationExecutionStatus.COMPLETED,
                AutomationExecution.finished_at >= cutoff,
            ).limit(1)
        )
    return recent is not None


async def _matches_condition_values(
    conditions: dict,
    chat: dict,
    rule_id: int | None = None,
    deps: AutomationDeps = DEFAULT_DEPS,
) -> tuple[bool, str | None]:
    if conditions.get("cooldown_minutes") and rule_id is not None:
        minutes = conditions["cooldown_minutes"]
        if await _cooldown_blocked(rule_id, chat["chat_id"], minutes, deps):
            return False, f"Ya se ejecutó para este lead hace menos de {minutes} minutos"
    matches, reason = matches_static_conditions(conditions, chat)
    if not matches:
        return False, reason
    if conditions.get("require_open_window"):
        window = await deps.get_customer_service_window(chat["chat_id"])
        if not window or not window["is_open"]:
            return False, "La ventana de WhatsApp está cerrada"
    if conditions.get("business_hours_only") and not is_business_hours(deps.now().astimezone(business_timezone())):
        return False, "Fuera del horario laboral (lunes a viernes, 08:00–18:00)"
    return True, None


async def _matches_conditions(
    rule: AutomationRule, chat: dict, deps: AutomationDeps = DEFAULT_DEPS
) -> tuple[bool, str | None]:
    return await _matches_condition_values(rule.conditions or {}, chat, rule.id, deps)


async def _matches_flow_condition(
    data: dict, chat: dict, deps: AutomationDeps = DEFAULT_DEPS
) -> tuple[bool, str]:
    condition_type = data.get("condition_type")
    value = data.get("value")
    if condition_type == FlowConditionType.STAGE_EQUALS:
        matches = chat.get("stage") == value
        return matches, f"Etapa {'coincide' if matches else 'no coincide'} con {value}"
    if condition_type == FlowConditionType.ORIGIN_CONTAINS:
        matches = str(value).lower() in (chat.get("origen") or "").lower()
        return matches, f"Origen {'contiene' if matches else 'no contiene'} {value}"
    if condition_type == FlowConditionType.SERVICE_CONTAINS:
        matches = str(value).lower() in (chat.get("servicio_interes") or "").lower()
        return matches, f"Servicio {'contiene' if matches else 'no contiene'} {value}"
    if condition_type == FlowConditionType.SELLER_EQUALS:
        matches = chat.get("vendedor_id") == value
        return matches, "Vendedor coincide" if matches else "Vendedor no coincide"
    if condition_type == FlowConditionType.TAG_PRESENT:
        matches = value in {tag["id"] for tag in chat.get("tags", [])}
        return matches, "Etiqueta presente" if matches else "Etiqueta ausente"
    if condition_type == FlowConditionType.WHATSAPP_WINDOW_OPEN:
        window = await deps.get_customer_service_window(chat["chat_id"])
        matches = bool(window and window["is_open"])
        return matches, "Ventana de WhatsApp abierta" if matches else "Ventana de WhatsApp cerrada"
    matches = is_business_hours(deps.now().astimezone(business_timezone()))
    return matches, "Dentro del horario laboral" if matches else "Fuera del horario laboral"


_flow_indexes = flow_indexes


async def simulate_visual_flow(rule_id: int, lead_id: str) -> dict:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        raise ValueError("Flujo visual no encontrado")
    validated = await validate_visual_flow(current["name"], current["flow_definition"])
    chat = await fetch_chat(lead_id)
    if not chat:
        raise ValueError("Lead no encontrado")
    matches, reason = await _matches_condition_values(validated["conditions"], chat, rule_id)
    if not matches:
        return {
            "lead_id": chat["chat_id"],
            "lead_name": chat.get("name"),
            "flow_version": current["flow_version"],
            "path": [{
                "type": "entry_conditions",
                "status": AutomationExecutionStatus.SKIPPED,
                "detail": reason,
            }],
        }
    nodes, edges = _flow_indexes(validated["flow_definition"])
    trigger = next(
        node for node in nodes.values() if node["type"] == FlowNodeType.TRIGGER
    )
    current_id = trigger["id"]
    path: list[dict] = []
    for _ in range(MAX_FLOW_NODES + 1):
        node = nodes[current_id]
        if node["type"] == FlowNodeType.TRIGGER:
            path.append({"node_id": current_id, "type": FlowNodeType.TRIGGER, "status": "matched"})
            current_id = edges[(current_id, FlowHandle.NEXT)]
        elif node["type"] == FlowNodeType.CONDITION:
            matches, detail = await _matches_flow_condition(node["data"], chat)
            branch = FlowHandle.YES if matches else FlowHandle.NO
            path.append({
                "node_id": current_id,
                "type": FlowNodeType.CONDITION,
                "status": "evaluated",
                "branch": branch, "detail": detail,
            })
            current_id = edges[(current_id, branch)]
        elif node["type"] == FlowNodeType.ACTION:
            action = node["data"]["action"]
            result = {"node_id": current_id, "type": action["type"], "status": "would_run"}
            if action["type"] == AutomationActionType.SEND_TEMPLATE:
                window = await get_customer_service_window(chat["chat_id"])
                if not window or not window["is_open"]:
                    result.update(status="would_fail", detail="La ventana de 24 horas está cerrada")
            path.append(result)
            current_id = edges[(current_id, FlowHandle.NEXT)]
        elif node["type"] == FlowNodeType.WAIT:
            path.append({
                "node_id": current_id,
                "type": FlowNodeType.WAIT,
                "status": "would_wait",
                "seconds": _wait_seconds(node["data"]),
            })
            current_id = edges[(current_id, FlowHandle.NEXT)]
        elif node["type"] == FlowNodeType.WAIT_ANY:
            # No hay forma de simular cuál condición se cumpliría primero en
            # la vida real — se muestra el bloque y se sigue por la rama del
            # temporizador (siempre presente como condición) para completar
            # el preview. Su salida es opcional: sin conexión, el flujo
            # termina acá.
            path.append({
                "node_id": current_id,
                "type": FlowNodeType.WAIT_ANY,
                "status": "would_wait",
                "conditions": node["data"].get("conditions", []),
            })
            next_id = edges.get((current_id, WaitAnyConditionKind.TIMER))
            if next_id is None:
                path.append({
                    "node_id": None,
                    "type": FlowNodeType.END,
                    "status": AutomationExecutionStatus.COMPLETED,
                })
                return {
                    "lead_id": chat["chat_id"], "lead_name": chat.get("name"),
                    "flow_version": current["flow_version"], "path": path,
                }
            current_id = next_id
        elif node["type"] == FlowNodeType.QUESTION:
            # Igual que wait_any: no hay forma de simular qué contesta el
            # cliente — se muestra el bloque y se sigue por "timeout".
            path.append({
                "node_id": current_id,
                "type": FlowNodeType.QUESTION,
                "status": "would_wait",
                "text": node["data"].get("text"),
                "buttons": node["data"].get("buttons", []),
            })
            current_id = edges[(current_id, QuestionHandle.TIMEOUT)]
        else:
            path.append({
                "node_id": current_id,
                "type": FlowNodeType.END,
                "status": AutomationExecutionStatus.COMPLETED,
            })
            return {
                "lead_id": chat["chat_id"], "lead_name": chat.get("name"),
                "flow_version": current["flow_version"], "path": path,
            }
    raise ValueError("La simulación excedió el máximo de bloques")


def _resolve_recipient(action: dict, chat: dict, payload: dict) -> int:
    if (
        action.get("recipient") == AutomationRecipient.SPECIFIC
        and action.get("user_id")
    ):
        return int(action["user_id"])
    if chat.get("vendedor_id"):
        return int(chat["vendedor_id"])
    if payload.get("assigned_user_id"):
        return int(payload["assigned_user_id"])
    raise ValueError("El lead no tiene vendedor asignado")


async def _action_create_task(action, chat, execution, rule, deps) -> dict:
    assigned_user_id = (
        action.get("assigned_user_id")
        or chat.get("vendedor_id")
        or (execution.event_payload or {}).get("assigned_user_id")
    )
    if not assigned_user_id:
        raise ValueError("No se puede crear la tarea porque el lead no tiene vendedor")
    due_at = deps.now() + timedelta(minutes=action["due_minutes"])
    remind_at = (
        due_at - timedelta(minutes=action["remind_minutes_before"])
        if action["remind_minutes_before"]
        else None
    )
    task = await deps.create_task({
        "lead_id": chat["chat_id"],
        "title": _render(action["title"], chat),
        "description": _render(action["description"], chat) if action.get("description") else None,
        "task_type": action["task_type"],
        "priority": action["priority"],
        "due_at": due_at,
        "remind_at": remind_at,
        "assigned_user_id": assigned_user_id,
    }, rule.created_by_user_id)
    await deps.broadcast({"type": "tasks_updated"})
    return {"status": AutomationExecutionStatus.COMPLETED, "task_id": task["id"]}


async def _action_change_service(action, chat, execution, rule, deps) -> dict:
    updated = await deps.update_lead(
        chat["chat_id"], {"servicio_interes": action["service"]}, "system", rule.created_by_user_id
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "lead_updated"})
    return {"status": AutomationExecutionStatus.COMPLETED, "service": action["service"]}


async def _action_assign_seller(action, chat, execution, rule, deps) -> dict:
    updated = await deps.update_lead(
        chat["chat_id"], {"vendedor_id": action["user_id"]}, "system", rule.created_by_user_id
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "lead_updated"})
    return {"status": AutomationExecutionStatus.COMPLETED, "user_id": action["user_id"]}


async def _action_add_tag(action, chat, execution, rule, deps) -> dict:
    if not await deps.assign_tag(chat["chat_id"], action["tag_id"], rule.created_by_user_id):
        raise ValueError("Lead o etiqueta no encontrado")
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "tag_changed"})
    return {"status": AutomationExecutionStatus.COMPLETED, "tag_id": action["tag_id"]}


async def _action_remove_tag(action, chat, execution, rule, deps) -> dict:
    removed = await deps.remove_tag(chat["chat_id"], action["tag_id"], rule.created_by_user_id)
    return {
        "status": (
            AutomationExecutionStatus.COMPLETED if removed else AutomationExecutionStatus.SKIPPED
        ),
        "tag_id": action["tag_id"],
    }


async def _action_change_stage(action, chat, execution, rule, deps) -> dict:
    updated = await deps.update_lead_stage(
        chat["chat_id"], LeadStage(action["stage"]), "system", rule.created_by_user_id,
        {"automation_rule_id": rule.id, "automation_execution_id": execution.id},
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "stage_changed"})
    return {"status": AutomationExecutionStatus.COMPLETED, "stage": action["stage"]}


async def _action_notify(action, chat, execution, rule, deps) -> dict:
    user_id = _resolve_recipient(action, chat, execution.event_payload or {})
    notification = await deps.create_notification(
        user_id,
        NotificationType.AUTOMATION,
        _render(action["title"], chat),
        _render(action["body"], chat),
        chat["chat_id"],
        str(execution.id),
        {"automation_rule_id": rule.id, "automation_rule_name": rule.name},
    )
    await deps.send_to_user(user_id, {"type": "notification_created", "notification": notification})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "notification_id": notification["id"],
        "user_id": user_id,
    }


async def _action_send_template(action, chat, execution, rule, deps) -> dict:
    async with deps.session() as session:
        template = await session.get(MessageTemplate, action["template_id"])
        attachments = (await session.execute(
            select(TemplateAttachment).where(TemplateAttachment.template_id == action["template_id"])
            .order_by(TemplateAttachment.position, TemplateAttachment.id)
        )).scalars().all()
    if (
        not template
        or not template.is_active
        or template.template_type != TemplateType.INTERNAL
        or template.interactive_type != InteractiveType.NONE
    ):
        raise ValueError("La plantilla automática dejó de ser una plantilla interna válida")
    window = await deps.get_customer_service_window(chat["chat_id"])
    if not window or not window["is_open"]:
        raise ValueError("No se envió WhatsApp porque la ventana de 24 horas está cerrada")
    text = _render(template.content, chat).strip()
    if not text and not attachments:
        raise ValueError("La plantilla no tiene contenido para enviar")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise ValueError("El contenido renderizado de la plantilla no es válido")

    items: list[dict] = []
    if text:
        items.append({"content": text, "payload": {"type": "text", "text": text}})
    for attachment in attachments:
        mediatype = mediatype_from_content_type(attachment.content_type)
        items.append({
            "media_url": attachment.media_url,
            "payload": {
                "type": "media", "media_url": attachment.media_url,
                "mediatype": mediatype, "filename": attachment.filename,
            },
        })
    # Un solo enqueue_messages para texto + todos los adjuntos: quedan
    # encolados atómicamente en una sola transacción, en vez de una llamada
    # por ítem.
    sent = await deps.enqueue_messages(chat["chat_id"], items)
    await deps.record_template_use(template.id, rule.created_by_user_id)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_ids": [message["id"] for message in sent],
        "template_id": template.id,
    }


async def _action_send_message(action, chat, execution, rule, deps) -> dict:
    """Envía texto libre sin pasar por una plantilla — para un mensaje de un
    solo uso dentro de un flujo puntual, cuando no vale la pena guardarlo
    como plantilla reutilizable."""
    window = await deps.get_customer_service_window(chat["chat_id"])
    if not window or not window["is_open"]:
        raise ValueError("No se envió WhatsApp porque la ventana de 24 horas está cerrada")
    text = _render(action["text"], chat).strip()
    if not text:
        raise ValueError("El mensaje no tiene contenido para enviar")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise ValueError("El contenido renderizado del mensaje no es válido")
    sent = await deps.enqueue_messages(
        chat["chat_id"], [{"content": text, "payload": {"type": "text", "text": text}}],
    )
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_react_to_last_customer_message(action, chat, execution, rule, deps) -> dict:
    """Reacciona al mensaje entrante más reciente, aunque el vendedor haya
    enviado otros mensajes después. WhatsApp solo admite una reacción propia
    por mensaje; una ejecución posterior reemplaza la anterior.
    """
    target = await deps.fetch_latest_customer_message_target(chat["chat_id"])
    if not target:
        raise ValueError("No hay un mensaje confirmado del cliente al que reaccionar")

    emoji = action["emoji"]
    key = {
        "remoteJid": chat["chat_id"],
        "fromMe": False,
        "id": target["wa_message_id"],
    }
    # Igual que la reacción manual: primero WhatsApp y luego el badge local,
    # para no mostrar como enviada una reacción que el cliente nunca recibió.
    await deps.send_reaction(key, emoji)
    message = await deps.set_message_reaction(
        chat["chat_id"], target["wa_message_id"], emoji, from_me=True,
    )
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "reaction"})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_id": message["id"] if message else target["id"],
        "wa_message_id": target["wa_message_id"],
        "emoji": emoji,
    }


async def _fetch_media_asset(action, deps: AutomationDeps) -> MediaAsset:
    async with deps.session() as session:
        asset = await session.get(MediaAsset, action["media_asset_id"])
    if not asset:
        raise ValueError("El archivo elegido ya no existe en la librería de medios")
    return asset


async def _last_outbound_media_message_id(chat_id: str, deps: AutomationDeps) -> str | None:
    """Para la condición `media_played` de una Pausa: el mensaje de imagen/
    video/audio más reciente que el vendedor le mandó a este lead antes de
    entrar a la espera — es lo que se vigila para saber cuándo lo reproduce.
    None si todavía no se le mandó nada de eso (la condición simplemente
    nunca se cumple, no es un error)."""
    async with deps.session() as session:
        return await session.scalar(
            select(WspMessage.wa_message_id).where(
                WspMessage.chat_id == chat_id,
                WspMessage.sender == "vendedor",
                WspMessage.message_type.in_(["image", "video", "audio"]),
                WspMessage.wa_message_id.isnot(None),
            ).order_by(WspMessage.sent_at.desc(), WspMessage.id.desc()).limit(1)
        )


async def _action_send_audio(action, chat, execution, rule, deps) -> dict:
    """Manda una nota de voz (PTT) desde un archivo ya subido a la librería
    de medios — no crea una plantilla para un envío de un solo uso."""
    asset = await _fetch_media_asset(action, deps)
    if not asset.content_type.startswith("audio/"):
        raise ValueError("El archivo elegido ya no es un audio")
    window = await deps.get_customer_service_window(chat["chat_id"])
    if not window or not window["is_open"]:
        raise ValueError("No se envió WhatsApp porque la ventana de 24 horas está cerrada")
    sent = await deps.enqueue_messages(chat["chat_id"], [{
        "media_url": asset.media_url,
        "payload": {"type": "audio", "media_url": asset.media_url},
    }])
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_send_attachment(action, chat, execution, rule, deps) -> dict:
    """Manda un adjunto (imagen/video/documento) de la librería de medios sin
    texto ni plantilla — mismo camino que ya usan los adjuntos de
    `_action_send_template`, apuntando a un `MediaAsset` en vez de un
    `TemplateAttachment`."""
    asset = await _fetch_media_asset(action, deps)
    window = await deps.get_customer_service_window(chat["chat_id"])
    if not window or not window["is_open"]:
        raise ValueError("No se envió WhatsApp porque la ventana de 24 horas está cerrada")
    mediatype = mediatype_from_content_type(asset.content_type)
    sent = await deps.enqueue_messages(chat["chat_id"], [{
        "media_url": asset.media_url,
        "payload": {
            "type": "media", "media_url": asset.media_url,
            "mediatype": mediatype, "filename": asset.filename,
        },
    }])
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _send_buttons_message(chat: dict, text: str, buttons: list[dict], deps: AutomationDeps) -> dict:
    """Manda un mensaje con botones nativos si la integración es WhatsApp
    Business; si no, cae al fallback de texto numerado (mismo que usa el
    envío manual de plantillas interactivas). Devuelve el mensaje encolado.
    Compartido por el nodo `question` (única forma de mandar botones desde
    un flujo: la acción `send_buttons` se reemplazó por ese nodo, que sí
    puede ramificar según la respuesta).

    A diferencia de la versión anterior, no decide acá mismo entre botones
    nativos y el fallback de texto numerado: encola un payload interactive y
    deja que el worker del outbox (message_outbox._send_payload) resuelva
    las capacidades en el momento real del envío — la misma lógica ya
    centralizada y probada que usa el envío manual de plantillas
    interactivas, en vez de reimplementarla acá."""
    sent = await deps.enqueue_messages(chat["chat_id"], [{
        "content": text,
        "payload": {
            "type": "interactive", "interactive_type": "buttons",
            "description": "",
            "config": {"title": text, "buttons": buttons},
        },
    }])
    return sent[0]


# Un handler por tipo de acción: agregar una acción nueva es sumar una entrada
# acá y su validación, sin tocar el despachador ni las acciones existentes.
ACTION_HANDLERS = {
    AutomationActionType.CREATE_TASK: _action_create_task,
    AutomationActionType.ASSIGN_SELLER: _action_assign_seller,
    AutomationActionType.CHANGE_SERVICE: _action_change_service,
    AutomationActionType.ADD_TAG: _action_add_tag,
    AutomationActionType.REMOVE_TAG: _action_remove_tag,
    AutomationActionType.CHANGE_STAGE: _action_change_stage,
    AutomationActionType.NOTIFY: _action_notify,
    AutomationActionType.SEND_TEMPLATE: _action_send_template,
    AutomationActionType.SEND_MESSAGE: _action_send_message,
    AutomationActionType.SEND_AUDIO: _action_send_audio,
    AutomationActionType.SEND_ATTACHMENT: _action_send_attachment,
    AutomationActionType.REACT_TO_LAST_CUSTOMER_MESSAGE: _action_react_to_last_customer_message,
}


async def _execute_action(
    action: dict,
    chat: dict,
    execution: AutomationExecution,
    rule: AutomationRule,
    deps: AutomationDeps = DEFAULT_DEPS,
) -> dict:
    handler = ACTION_HANDLERS.get(action["type"])
    if handler is None:
        raise ValueError(f"Acción no soportada: {action['type']}")
    result = await handler(action, chat, execution, rule, deps)
    return {"type": action["type"], **result}


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
    try:
        notification = await deps.create_notification(
            rule.created_by_user_id,
            NotificationType.AUTOMATION,
            f"Automatización con error: {rule.name}"[:160],
            (error or "La ejecución falló")[:1000],
            execution.lead_id,
            f"execution-failed:{execution.id}",
            {"automation_rule_id": rule.id, "automation_execution_id": execution.id},
        )
        await deps.send_to_user(
            rule.created_by_user_id, {"type": "notification_created", "notification": notification}
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
    try:
        for _ in range(MAX_FLOW_NODES + 1):
            if not current_id or current_id not in nodes:
                raise ValueError("El flujo perdió la referencia al siguiente bloque")
            node = nodes[current_id]
            path.append(current_id)
            if node["type"] == FlowNodeType.TRIGGER:
                current_id = edges[(current_id, FlowHandle.NEXT)]
                saved = await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                deps=deps,
                )
                if not saved:
                    return  # cancelada externamente: no proceses más nodos
                continue
            if node["type"] == FlowNodeType.CONDITION:
                matches, detail = await _matches_flow_condition(node["data"], chat, deps)
                branch = FlowHandle.YES if matches else FlowHandle.NO
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": FlowNodeType.CONDITION,
                    "status": AutomationExecutionStatus.COMPLETED,
                    "branch": branch,
                    "detail": detail,
                })
                current_id = edges[(current_id, branch)]
                saved = await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                deps=deps,
                )
                if not saved:
                    return  # cancelada externamente: no proceses más nodos
                continue
            if node["type"] == FlowNodeType.ACTION:
                action = node["data"]["action"]
                result = await _execute_action(action, chat, execution, rule, deps)
                results.append({"position": len(results) + 1, "node_id": node["id"], **result})
                current_id = edges[(current_id, FlowHandle.NEXT)]
                saved = await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                deps=deps,
                )
                if not saved:
                    return  # cancelada externamente: no proceses más nodos
                continue
            if node["type"] == FlowNodeType.WAIT:
                seconds = _wait_seconds(node["data"])
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": FlowNodeType.WAIT,
                    "status": AutomationExecutionStatus.SCHEDULED,
                    "seconds": seconds,
                })
                current_id = edges[(current_id, FlowHandle.NEXT)]
                await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.SCHEDULED,
                    results,
                    current_id,
                    path,
                    flow_version,
                    scheduled_for=datetime.now(timezone.utc) + timedelta(seconds=seconds),
                deps=deps,
                )
                return
            if node["type"] == FlowNodeType.WAIT_ANY:
                conditions = node["data"]["conditions"]
                if state.get("waiting_at_node") != current_id:
                    # Primera llegada: no se sabe todavía qué rama seguir, así
                    # que a diferencia de Wait acá NO se avanza — se pausa en
                    # este mismo bloque hasta que pase algo (el temporizador
                    # cumple, llega un mensaje o se reproduce lo último que
                    # se le mandó, según qué condiciones estén configuradas).
                    timer = next(c for c in conditions if c["kind"] == WaitAnyConditionKind.TIMER)
                    has_message = any(c["kind"] == WaitAnyConditionKind.MESSAGE for c in conditions)
                    has_media_played = any(c["kind"] == WaitAnyConditionKind.MEDIA_PLAYED for c in conditions)
                    watching_message_id = (
                        await _last_outbound_media_message_id(chat["chat_id"], deps) if has_media_played else None
                    )
                    results.append({
                        "position": len(results) + 1, "node_id": node["id"],
                        "type": FlowNodeType.WAIT_ANY,
                        "status": AutomationExecutionStatus.SCHEDULED,
                        "conditions": conditions,
                    })
                    await _persist_visual_execution(
                        execution.id,
                        AutomationExecutionStatus.SCHEDULED,
                        results,
                        current_id,
                        path,
                        flow_version,
                        scheduled_for=datetime.now(timezone.utc) + timedelta(seconds=timer["seconds"]),
                        wait_any_state={
                            "waiting_at_node": current_id,
                            # ISO plano (no _ts/Z) porque esto es bookkeeping
                            # interno que _discover_wait_any_replies vuelve a
                            # parsear con datetime.fromisoformat, no un campo
                            # que sirva la API al frontend.
                            "waiting_since": datetime.now(timezone.utc).isoformat(),
                            "awaiting_message": has_message,
                            "watching_message_id": watching_message_id,
                        },
                    deps=deps,
                    )
                    return
                # Reanudación: resume_reason lo puso el descubrimiento de
                # mensajes/reproducciones (_discover_wait_any_replies) si algo
                # pasó antes que el temporizador; si no está seteado, es
                # porque scheduled_for se cumplió por el camino normal (timer).
                # "Excepto horas laborales" tiene prioridad sobre cualquier
                # otra rama: si está configurada y no es horario laboral en
                # el momento de resolver, la ejecución sigue por ahí en vez
                # de por lo que haya pasado.
                branch = state.get("resume_reason") or WaitAnyConditionKind.TIMER
                has_business_hours = any(c["kind"] == WaitAnyConditionKind.BUSINESS_HOURS for c in conditions)
                if has_business_hours and not is_business_hours(datetime.now(business_timezone())):
                    branch = WaitAnyConditionKind.BUSINESS_HOURS
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": FlowNodeType.WAIT_ANY,
                    "status": AutomationExecutionStatus.COMPLETED,
                    "branch": branch,
                })
                next_id = edges.get((current_id, branch))
                if next_id is None:
                    # Solo la rama del temporizador puede llegar sin conexión
                    # (es la única opcional) — el flujo termina acá, igual que
                    # si hubiera llegado a un bloque Fin.
                    results.append({
                        "position": len(results) + 1, "node_id": None,
                        "type": FlowNodeType.END,
                        "status": AutomationExecutionStatus.COMPLETED,
                    })
                    await _persist_visual_execution(
                        execution.id,
                        AutomationExecutionStatus.COMPLETED,
                        results,
                        None,
                        path,
                        flow_version,
                    deps=deps,
                    )
                    return
                current_id = next_id
                saved = await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                deps=deps,
                )
                if not saved:
                    return  # cancelada externamente: no proceses más nodos
                continue
            if node["type"] == FlowNodeType.QUESTION:
                if state.get("waiting_at_node") != current_id:
                    # Primera llegada: manda el mensaje con botones y pausa —
                    # mismo mecanismo que wait_any, pero acá siempre se espera
                    # una respuesta (no hay condiciones opcionales) y además
                    # se guarda `question_buttons` para poder matchear la
                    # respuesta del cliente contra un botón concreto.
                    text = _render(node["data"]["text"], chat).strip()
                    buttons_data = node["data"]["buttons"]
                    if not text:
                        raise ValueError("La pregunta no tiene contenido para enviar")
                    window = await deps.get_customer_service_window(chat["chat_id"])
                    if not window or not window["is_open"]:
                        raise ValueError("No se envió WhatsApp porque la ventana de 24 horas está cerrada")
                    buttons = [
                        {"type": "reply", "displayText": button["label"], "id": button["id"]}
                        for button in buttons_data
                    ]
                    message = await _send_buttons_message(chat, text, buttons, deps)
                    results.append({
                        "position": len(results) + 1, "node_id": node["id"],
                        "type": FlowNodeType.QUESTION,
                        "status": AutomationExecutionStatus.SCHEDULED,
                        "message_ids": [message["id"]],
                    })
                    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
                    await _persist_visual_execution(
                        execution.id,
                        AutomationExecutionStatus.SCHEDULED,
                        results,
                        current_id,
                        path,
                        flow_version,
                        scheduled_for=datetime.now(timezone.utc) + timedelta(seconds=node["data"]["timeout_seconds"]),
                        wait_any_state={
                            "waiting_at_node": current_id,
                            "waiting_since": datetime.now(timezone.utc).isoformat(),
                            "awaiting_message": True,
                            "question_buttons": buttons_data,
                        },
                    deps=deps,
                    )
                    return
                # Reanudación: resume_reason es un id de botón (matcheado por
                # _discover_wait_any_replies), "other" (respondió algo que no
                # matchea ningún botón) o, si no está seteado, "timeout" (no
                # contestó a tiempo).
                branch = state.get("resume_reason") or QuestionHandle.TIMEOUT
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": FlowNodeType.QUESTION,
                    "status": AutomationExecutionStatus.COMPLETED,
                    "branch": branch,
                })
                current_id = edges[(current_id, branch)]
                saved = await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                deps=deps,
                )
                if not saved:
                    return  # cancelada externamente: no proceses más nodos
                continue
            results.append({
                "position": len(results) + 1, "node_id": node["id"],
                "type": FlowNodeType.END,
                "status": AutomationExecutionStatus.COMPLETED,
            })
            await _persist_visual_execution(
                execution.id,
                AutomationExecutionStatus.COMPLETED,
                results,
                None,
                path,
                flow_version,
            deps=deps,
            )
            return
        raise ValueError("El flujo excedió el máximo de bloques permitidos")
    except (KeyError, ValueError, EvolutionApiError, httpx.HTTPError) as exc:
        action_type = "flow"
        if current_id in nodes and nodes[current_id]["type"] == FlowNodeType.ACTION:
            action_type = nodes[current_id]["data"].get("action", {}).get("type", FlowNodeType.ACTION)
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
        logger.exception("Unexpected error running visual automation execution %s", execution.id)
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

    results = list(execution.action_results or [])
    if not results:
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
        # Reanuda desde la primera acción sin resultado persistido — un
        # reintento tras un crash no repite WhatsApps ni tareas ya creadas.
        for index in range(len(results), len(actions)):
            result = await _execute_action(actions[index], chat, execution, rule, deps)
            results.append({"position": index + 1, **result})
            saved = await _save_execution(execution_id, deps, action_results=results)
            if not saved:
                return  # cancelada externamente: no proceses más acciones
    except (ValueError, EvolutionApiError, httpx.HTTPError) as exc:
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
        logger.exception("Unexpected error running automation execution %s", execution_id)
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
    if not ids:
        return 0
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXECUTIONS)

    async def run_bounded(execution_id: int) -> None:
        async with semaphore:
            await _run_execution(execution_id)

    await asyncio.gather(*(run_bounded(execution_id) for execution_id in ids))
    await manager.broadcast({"type": "automations_updated"})
    return len(ids)


async def _discover_recent_inbound_messages() -> None:
    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with get_sessionmaker()() as session:
        has_rules = await session.scalar(select(AutomationRule.id).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type.in_([
                AutomationTrigger.MESSAGE_RECEIVED,
                AutomationTrigger.LEAD_CREATED,
            ]),
        ).limit(1))
        if not has_rules:
            return
        rows = (await session.execute(
            select(WspMessage.id, WspMessage.wa_message_id, WspMessage.chat_id, WspMessage.content).where(
                WspMessage.sender == "cliente", WspMessage.sent_at >= since
            ).order_by(WspMessage.sent_at.asc(), WspMessage.id.asc()).limit(200)
        )).mappings().all()
    for row in rows:
        await schedule_automation_event(
            AutomationTrigger.MESSAGE_RECEIVED,
            row["chat_id"],
            f"message:{row['wa_message_id'] or row['id']}",
            {"message_id": str(row["wa_message_id"] or row["id"]), "content": row["content"]},
        )


def _normalize_reply_text(value: str) -> str:
    """trim + minúsculas + sin acentos, para matchear la respuesta libre del
    cliente contra el label de un botón sin depender de mayúsculas/tildes."""
    decomposed = unicodedata.normalize("NFKD", value.strip().lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _match_question_button(buttons: list[dict], message_type: str | None, content: str | None, payload: dict | None) -> str:
    """Resuelve a qué botón corresponde la respuesta del cliente: por
    `selected_id` si tocó un botón nativo, si no por número de posición o por
    el texto del botón (el fallback de texto numerado usa exactamente ese
    esquema); si no matchea nada, "otra respuesta"."""
    if message_type == "interactive" and isinstance(payload, dict):
        selected_id = payload.get("selected_id")
        if selected_id and any(button["id"] == selected_id for button in buttons):
            return selected_id
    normalized = _normalize_reply_text(content or "")
    if normalized.isdigit():
        index = int(normalized) - 1
        if 0 <= index < len(buttons):
            return buttons[index]["id"]
    for button in buttons:
        if _normalize_reply_text(button["label"]) == normalized:
            return button["id"]
    return QuestionHandle.OTHER


async def _discover_wait_any_replies() -> None:
    """Reanuda ejecuciones pausadas en un bloque Pausa (wait_any, condición
    "hasta recibir mensaje" o "hasta que se reproduce lo enviado") o Pregunta
    (question): si el lead escribió después de entrar a la espera, o si el
    mensaje que se vigila ya quedó en READ/PLAYED, adelanta `scheduled_for` a
    ahora y marca `resume_reason` para que `_run_visual_execution` siga por
    esa rama en vez de la del timer. Análoga a
    `_discover_recent_inbound_messages`, pero para ejecuciones que ya están
    corriendo (no dispara ejecuciones nuevas)."""
    async with get_sessionmaker()() as session:
        waiting = (await session.execute(
            select(AutomationExecution.id, AutomationExecution.lead_id, AutomationExecution.flow_state)
            .where(
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                or_(
                    AutomationExecution.flow_state["awaiting_message"].astext == "true",
                    AutomationExecution.flow_state["watching_message_id"].astext.isnot(None),
                ),
            )
            .limit(200)
        )).all()
    resumed = False
    for execution_id, lead_id, flow_state in waiting:
        waiting_since = flow_state.get("waiting_since") if flow_state else None
        if not lead_id or not waiting_since:
            continue
        since = datetime.fromisoformat(waiting_since)
        resume_reason = None
        async with get_sessionmaker()() as session:
            if flow_state.get("awaiting_message"):
                reply = (await session.execute(
                    select(WspMessage.message_type, WspMessage.content, WspMessage.payload).where(
                        WspMessage.chat_id == lead_id,
                        WspMessage.sender == "cliente",
                        WspMessage.sent_at > since,
                    ).order_by(WspMessage.sent_at.asc(), WspMessage.id.asc()).limit(1)
                )).mappings().first()
                if reply:
                    question_buttons = flow_state.get("question_buttons")
                    resume_reason = (
                        _match_question_button(question_buttons, reply["message_type"], reply["content"], reply["payload"])
                        if question_buttons
                        else WaitAnyConditionKind.MESSAGE
                    )
            watching_message_id = flow_state.get("watching_message_id")
            if resume_reason is None and watching_message_id:
                status = await session.scalar(
                    select(WspMessage.status).where(WspMessage.wa_message_id == watching_message_id)
                )
                if status in ("READ", "PLAYED"):
                    resume_reason = WaitAnyConditionKind.MEDIA_PLAYED
            if resume_reason is None:
                continue
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id,
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
            ).values(
                scheduled_for=datetime.now(timezone.utc),
                flow_state={**flow_state, "resume_reason": resume_reason},
            ))
            await session.commit()
            resumed = True
    if resumed:
        _wake.set()


async def _discover_timed_events() -> None:
    async with get_sessionmaker()() as session:
        rules = (await session.execute(select(AutomationRule).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type.in_([
                AutomationTrigger.SELLER_RESPONSE_OVERDUE,
                AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
                AutomationTrigger.TASK_DUE,
            ]),
        ))).scalars().all()
    for rule in rules:
        if rule.trigger_type == AutomationTrigger.TASK_DUE:
            async with get_sessionmaker()() as session:
                tasks = (await session.execute(select(
                    LeadTask.id, LeadTask.lead_id, LeadTask.assigned_user_id, LeadTask.title,
                    LeadTask.due_at,
                ).where(
                    LeadTask.status == TaskStatus.PENDING,
                    LeadTask.due_at <= datetime.now(timezone.utc),
                ).limit(200))).mappings().all()
            for task in tasks:
                # Clave anclada al vencimiento: editar título o prioridad de la
                # tarea no re-dispara la regla; mover la fecha límite sí.
                await schedule_automation_event(
                    AutomationTrigger.TASK_DUE,
                    task["lead_id"],
                    f"task:{task['id']}:{_ts(task['due_at'])}", {
                        "task_id": task["id"],
                        "assigned_user_id": task["assigned_user_id"],
                        "title": task["title"],
                        "due_at": _ts(task["due_at"]),
                    }, rule.id
                )
            continue
        expected_sender = (
            "cliente"
            if rule.trigger_type == AutomationTrigger.SELLER_RESPONSE_OVERDUE
            else "vendedor"
        )
        now = datetime.now(timezone.utc)
        minutes = int((rule.trigger_config or {}).get("minutes", 1))
        threshold = now - timedelta(minutes=minutes)
        # Solo silencios recientes: chats sin actividad desde antes del
        # lookback no disparan — activar una regla no puede provocar un envío
        # masivo a conversaciones viejas. La cota además permite que la query
        # use idx_wsp_messages_sent_at en vez de recorrer toda la tabla.
        lookback = now - timedelta(minutes=minutes + OVERDUE_LOOKBACK_GRACE_MINUTES)
        last_message = select(
            WspMessage.id, WspMessage.chat_id, WspMessage.sender, WspMessage.sent_at,
        ).where(WspMessage.sent_at >= lookback).order_by(
            WspMessage.chat_id, WspMessage.sent_at.desc(), WspMessage.id.desc()
        ).distinct(WspMessage.chat_id).subquery()
        async with get_sessionmaker()() as session:
            rows = (await session.execute(select(last_message).where(
                last_message.c.sender == expected_sender,
                last_message.c.sent_at <= threshold,
            ).limit(500))).mappings().all()
            anchors: dict[str, int] = {}
            if rule.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE and rows:
                # La deduplicación se ancla al último mensaje DEL CLIENTE: los
                # follow-ups que envía la propia regla crean mensajes nuevos
                # del vendedor y, sin este ancla, cada uno re-dispararía la
                # regla en un goteo infinito hasta que el cliente responda.
                anchors = dict((await session.execute(
                    select(WspMessage.chat_id, WspMessage.id).where(
                        WspMessage.chat_id.in_([row["chat_id"] for row in rows]),
                        WspMessage.sender == "cliente",
                        WspMessage.sent_at >= lookback,
                    ).order_by(
                        WspMessage.chat_id, WspMessage.sent_at.desc(), WspMessage.id.desc()
                    ).distinct(WspMessage.chat_id)
                )).all())
        for row in rows:
            if rule.trigger_type == AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE:
                anchor = anchors.get(row["chat_id"])
                event_key = f"silence:{anchor}" if anchor else f"silence:none:{row['chat_id']}"
            else:
                event_key = f"overdue:{row['id']}"
            await schedule_automation_event(
                AutomationTrigger(rule.trigger_type),
                row["chat_id"],
                event_key,
                {"last_message_id": str(row["id"]), "last_sender": row["sender"], "last_message_at": _ts(row["sent_at"])},
                rule.id,
            )


async def _release_stale_executions() -> None:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=STALE_EXECUTION_MINUTES)
    async with get_sessionmaker()() as session:
        # Las que ya agotaron sus reclamos no se re-agendan más: quedan failed
        # para que el fallo sea visible en vez de reintentarse para siempre.
        exhausted = (await session.execute(update(AutomationExecution).where(
            AutomationExecution.status == AutomationExecutionStatus.RUNNING,
            AutomationExecution.started_at < cutoff,
            AutomationExecution.attempts >= MAX_EXECUTION_ATTEMPTS,
        ).values(
            status=AutomationExecutionStatus.FAILED,
            error="Interrumpida demasiadas veces; no se volverá a reintentar",
            finished_at=now,
        ).returning(AutomationExecution.id))).scalars().all()
        await session.execute(update(AutomationExecution).where(
            AutomationExecution.status == AutomationExecutionStatus.RUNNING,
            AutomationExecution.started_at < cutoff,
        ).values(
            status=AutomationExecutionStatus.SCHEDULED,
            started_at=None,
            error="Reintentando una ejecución interrumpida",
            attempts=AutomationExecution.attempts + 1,
        ))
        await session.commit()
    for execution_id in exhausted:
        async with get_sessionmaker()() as session:
            execution = await session.get(AutomationExecution, execution_id)
            rule = await session.get(AutomationRule, execution.rule_id) if execution else None
        if execution and rule:
            await _notify_execution_failure(rule, execution, execution.error or "")


async def backfill_automation_state() -> None:
    """Migraciones de datos idempotentes que corren al arranque.

    1. Copia las definiciones publicadas a automation_flow_versions — las
       instalaciones previas solo las tenían embebidas en la regla y en el
       flow_state de cada ejecución.
    2. Reescribe las claves de eventos task_due del formato viejo
       task:{id}:{updated_at} al nuevo task:{id}:{due_at}, para que el deploy
       no re-dispare automatizaciones de tareas ya procesadas.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        published_rules = (await session.execute(select(
            AutomationRule.id, AutomationRule.flow_version, AutomationRule.published_flow_definition,
        ).where(
            AutomationRule.builder_mode == AutomationBuilderMode.VISUAL,
            AutomationRule.published_flow_definition.is_not(None),
            AutomationRule.flow_version > 0,
        ))).mappings().all()
        for rule in published_rules:
            await session.execute(pg_insert(AutomationFlowVersion).values(
                rule_id=rule["id"],
                version=rule["flow_version"],
                definition=rule["published_flow_definition"],
                created_at=now,
            ).on_conflict_do_nothing(
                index_elements=[AutomationFlowVersion.rule_id, AutomationFlowVersion.version]
            ))

        rows = (await session.execute(
            select(AutomationExecution.id, AutomationExecution.rule_id, AutomationExecution.event_key).where(
                AutomationExecution.trigger_type == AutomationTrigger.TASK_DUE
            ).order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc())
        )).mappings().all()
        task_ids = {
            int(row["event_key"].split(":")[1])
            for row in rows
            if row["event_key"].startswith("task:") and row["event_key"].split(":")[1].isdigit()
        }
        due_map: dict[int, datetime] = {}
        if task_ids:
            due_map = dict((await session.execute(
                select(LeadTask.id, LeadTask.due_at).where(LeadTask.id.in_(task_ids))
            )).all())
        existing_keys = {(row["rule_id"], row["event_key"]) for row in rows}
        migrated: set[tuple[int, int]] = set()
        for row in rows:  # ordenadas de más reciente a más antigua
            parts = row["event_key"].split(":")
            if len(parts) < 3 or parts[0] != "task" or not parts[1].isdigit():
                continue
            task_id = int(parts[1])
            if (row["rule_id"], task_id) in migrated:
                continue
            migrated.add((row["rule_id"], task_id))
            due_at = due_map.get(task_id)
            if due_at is None:
                continue
            new_key = f"task:{task_id}:{_ts(due_at)}"
            if new_key == row["event_key"] or (row["rule_id"], new_key) in existing_keys:
                continue
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == row["id"]
            ).values(event_key=new_key))
            existing_keys.add((row["rule_id"], new_key))
        await session.commit()


async def watch_automations() -> None:
    next_housekeeping_at = 0.0
    while True:
        try:
            now_mono = monotonic()
            if now_mono >= next_housekeeping_at:
                await _release_stale_executions()
                await _discover_recent_inbound_messages()
                await _discover_timed_events()
                await _discover_wait_any_replies()
                next_housekeeping_at = now_mono + 60.0
            await process_due_automation_executions()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error processing automations")
        # Duerme hasta el próximo ciclo o hasta que un trigger active _wake —
        # así los eventos de los routers se procesan al instante sin que la
        # request HTTP tenga que esperar a las acciones.
        try:
            await asyncio.wait_for(_wake.wait(), timeout=AUTOMATION_POLL_SECONDS)
        except TimeoutError:
            pass
        _wake.clear()
