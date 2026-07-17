import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from domain_types import (
    AutomationActionType,
    AutomationBuilderMode,
    AutomationExecutionStatus,
    AutomationRecipient,
    AutomationTrigger,
    FlowConditionType,
    FlowHandle,
    FlowNodeType,
    NotificationType,
    TaskPriority,
    TaskStatus,
    TaskType,
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
from services.evolution_service import EvolutionApiError, send_whatsapp_text
from services.notification_service import create_system_notification
from services.productivity_service import create_task, record_template_use
from services.ws_manager import manager

logger = logging.getLogger(__name__)
AUTOMATION_POLL_SECONDS = 10
MAX_ACTIONS = 10
# Cuántas ejecuciones vencidas corren en paralelo por ciclo del watcher.
MAX_CONCURRENT_EXECUTIONS = 5
# Reclamos máximos de una misma ejecución antes de marcarla failed — evita
# reintentar para siempre una ejecución que se interrumpe una y otra vez.
MAX_EXECUTION_ATTEMPTS = 3
# Un flujo visual legítimo (varias llamadas a Evolution API de 30-60s) puede
# superar los 10 minutos; con menos margen se re-agendaría una ejecución viva.
STALE_EXECUTION_MINUTES = 15
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
CRM_VARIABLES = {"nombre", "telefono", "servicio", "vendedor", "fecha_actual"}

# Los triggers de los routers lo activan para que watch_automations procese la
# cola de inmediato sin bloquear la request HTTP del usuario (una acción
# send_template puede tardar hasta 30s esperando a Evolution API).
_wake = asyncio.Event()


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _render(value: str, chat: dict) -> str:
    values = {
        "nombre": chat.get("name") or "",
        "telefono": chat.get("phone") or "",
        "servicio": chat.get("servicio_interes") or "",
        "vendedor": chat.get("vendedor") or "",
        "fecha_actual": datetime.now(ZoneInfo("America/Lima")).strftime("%d/%m/%Y"),
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda match: values.get(match.group(1), match.group(0)), value)


def _unknown_variables(value: str) -> set[str]:
    return set(re.findall(r"\{\{(\w+)\}\}", value)) - CRM_VARIABLES


def _wa_message_id(response: dict) -> str | None:
    key = response.get("key") if isinstance(response, dict) else None
    return key.get("id") if isinstance(key, dict) else None


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
        "is_active": row["is_active"],
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
        AutomationRule.is_active,
        AutomationRule.created_by_user_id,
        User.name.label("created_by_name"),
        execution_count.label("execution_count"),
        last_execution_at.label("last_execution_at"),
        last_execution_status.label("last_execution_status"),
        AutomationRule.created_at,
        AutomationRule.updated_at,
    ).join(User, User.id == AutomationRule.created_by_user_id).order_by(
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


async def update_automation_rule(rule_id: int, values: dict) -> dict | None:
    if values:
        values["updated_at"] = datetime.now(timezone.utc)
        async with get_sessionmaker()() as session:
            result = await session.execute(
                update(AutomationRule).where(AutomationRule.id == rule_id).values(**values)
            )
            await session.commit()
        if not result.rowcount:
            return None
    return await get_automation_rule(rule_id)


async def list_automation_executions(
    rule_id: int | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[dict]:
    stmt = select(
        AutomationExecution.id,
        AutomationExecution.rule_id,
        AutomationRule.name.label("rule_name"),
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
    ).join(AutomationRule, AutomationRule.id == AutomationExecution.rule_id).outerjoin(
        Lead, Lead.remote_jid == AutomationExecution.lead_id
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationExecution.rule_id == rule_id)
    if status:
        stmt = stmt.where(AutomationExecution.status == status)
    stmt = stmt.order_by(AutomationExecution.created_at.desc(), AutomationExecution.id.desc()).limit(limit)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_execution_dict(row) for row in rows]


async def validate_automation_rule(values: dict) -> dict:
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

    conditions = values.get("conditions") if isinstance(values.get("conditions"), dict) else {}
    normalized_conditions = {
        "stage": str(conditions.get("stage") or "").strip() or None,
        "origin_contains": str(conditions.get("origin_contains") or "").strip()[:120] or None,
        "service_contains": str(conditions.get("service_contains") or "").strip()[:120] or None,
        "seller_id": int(conditions["seller_id"]) if conditions.get("seller_id") else None,
        "tag_id": int(conditions["tag_id"]) if conditions.get("tag_id") else None,
        "require_open_window": bool(conditions.get("require_open_window", False)),
        "business_hours_only": bool(conditions.get("business_hours_only", False)),
    }
    if normalized_conditions["stage"] and normalized_conditions["stage"] not in {stage.value for stage in LeadStage}:
        raise ValueError("Etapa de condición inválida")

    actions = values.get("actions") if isinstance(values.get("actions"), list) else []
    if not 1 <= len(actions) <= MAX_ACTIONS:
        raise ValueError(f"Configura entre 1 y {MAX_ACTIONS} acciones")
    normalized_actions: list[dict] = []
    referenced_users: set[int] = set()
    referenced_tags: set[int] = set()
    referenced_templates: set[int] = set()
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
        else:
            template_id = int(raw.get("template_id") or 0)
            if not template_id:
                raise ValueError(f"Acción {position}: selecciona una plantilla")
            referenced_templates.add(template_id)
            normalized_actions.append({"type": action_type, "template_id": template_id})

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
            valid_ids = set()
            for template in templates:
                attachment_count = await session.scalar(
                    select(func.count(TemplateAttachment.id)).where(TemplateAttachment.template_id == template.id)
                )
                if (
                    template.is_active
                    and template.template_type == "internal"
                    and template.interactive_type == "none"
                    and not attachment_count
                ):
                    valid_ids.add(template.id)
            if valid_ids != referenced_templates:
                raise ValueError("El envío automático solo admite plantillas internas activas de texto")

    return {
        "name": name,
        "trigger_type": trigger_type,
        "trigger_config": trigger_config,
        "conditions": normalized_conditions,
        "actions": normalized_actions,
        "delay_minutes": int(values.get("delay_minutes") or 0),
        "is_active": bool(values.get("is_active", True)),
    }


def _normalize_flow_position(value: object) -> dict:
    position = value if isinstance(value, dict) else {}
    return {
        "x": max(0, min(4000, int(position.get("x") or 0))),
        "y": max(0, min(4000, int(position.get("y") or 0))),
    }


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
    edges: list[dict] = []
    edge_ids: set[str] = set()
    for position, raw_edge in enumerate(raw_edges, start=1):
        if not isinstance(raw_edge, dict):
            raise ValueError(f"Conexión {position}: formato inválido")
        source = str(raw_edge.get("source") or "")
        target = str(raw_edge.get("target") or "")
        handle = str(raw_edge.get("source_handle") or FlowHandle.NEXT)
        edge_id = str(raw_edge.get("id") or f"{source}:{handle}:{target}")[:160]
        if source not in ids or target not in ids or source == target:
            raise ValueError(f"Conexión {position}: origen o destino inválido")
        if handle not in FLOW_HANDLES or edge_id in edge_ids:
            raise ValueError(f"Conexión {position}: salida o identificador inválido")
        edge_ids.add(edge_id)
        edges.append({"id": edge_id, "source": source, "target": target, "source_handle": handle})
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
        "flow_definition": {"nodes": nodes, "edges": edges},
    }


async def validate_visual_flow(name: str, definition: dict) -> dict:
    name = str(name or "").strip()
    if not name or len(name) > 120:
        raise ValueError("El nombre debe tener entre 1 y 120 caracteres")
    if not isinstance(definition, dict):
        raise ValueError("La definición del flujo no es válida")
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
            minutes = int(data.get("minutes") or 0)
            if not 1 <= minutes <= 10080:
                raise ValueError(f"Espera {position}: configura entre 1 minuto y 7 días")
            normalized_data = {"minutes": minutes}
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

    normalized_action_values = await validate_automation_rule({
        "name": name,
        "trigger_type": trigger_nodes[0]["data"]["trigger_type"],
        "trigger_config": {"minutes": trigger_nodes[0]["data"].get("minutes")},
        "conditions": {},
        "actions": [action for _, action in action_nodes],
        "delay_minutes": 0,
        "is_active": False,
    })
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

    normalized_edges: list[dict] = []
    outgoing: dict[str, list[dict]] = {node_id: [] for node_id in ids}
    incoming: dict[str, int] = {node_id: 0 for node_id in ids}
    edge_ids: set[str] = set()
    for position, raw_edge in enumerate(raw_edges, start=1):
        if not isinstance(raw_edge, dict):
            raise ValueError(f"Conexión {position}: formato inválido")
        source = str(raw_edge.get("source") or "")
        target = str(raw_edge.get("target") or "")
        handle = str(raw_edge.get("source_handle") or FlowHandle.NEXT)
        edge_id = str(raw_edge.get("id") or f"{source}:{handle}:{target}")[:160]
        if source not in ids or target not in ids or source == target:
            raise ValueError(f"Conexión {position}: origen o destino inválido")
        if edge_id in edge_ids:
            raise ValueError(f"Conexión {position}: identificador duplicado")
        edge_ids.add(edge_id)
        edge = {"id": edge_id, "source": source, "target": target, "source_handle": handle}
        normalized_edges.append(edge)
        outgoing[source].append(edge)
        incoming[target] += 1

    nodes_by_id = {node["id"]: node for node in normalized_nodes}
    trigger_id = trigger_nodes[0]["id"]
    for node in normalized_nodes:
        node_id = node["id"]
        edges = outgoing[node_id]
        if node["type"] == FlowNodeType.END:
            if edges:
                raise ValueError("Un bloque Fin no puede tener conexiones de salida")
        elif node["type"] == FlowNodeType.CONDITION:
            handles = [edge["source_handle"] for edge in edges]
            if sorted(handles) != sorted([FlowHandle.NO, FlowHandle.YES]):
                raise ValueError("Cada condición debe tener exactamente una salida Sí y una salida No")
        elif len(edges) != 1 or edges[0]["source_handle"] != FlowHandle.NEXT:
            raise ValueError("Cada disparador, acción o espera debe tener exactamente una salida")
        if node_id != trigger_id and not incoming[node_id]:
            raise ValueError("Todos los bloques deben estar conectados desde el disparador")

    visiting: set[str] = set()
    visited: set[str] = set()

    def walk(node_id: str) -> None:
        if node_id in visiting:
            raise ValueError("El flujo contiene un ciclo. Usa una espera y una nueva regla para evitar bucles")
        if node_id in visited:
            return
        visiting.add(node_id)
        for edge in outgoing[node_id]:
            walk(edge["target"])
        visiting.remove(node_id)
        visited.add(node_id)

    walk(trigger_id)
    if visited != ids:
        raise ValueError("Hay bloques que no son alcanzables desde el disparador")

    return {
        "name": name,
        "trigger_type": trigger_nodes[0]["data"]["trigger_type"],
        "trigger_config": normalized_action_values["trigger_config"],
        "flow_definition": {"nodes": normalized_nodes, "edges": normalized_edges},
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


async def schedule_automation_event(
    trigger_type: AutomationTrigger,
    lead_id: str,
    event_key: str,
    payload: dict | None = None,
    rule_id: int | None = None,
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
        if await session.get(Lead, lead_id) is None:
            # debug y no warning: el watcher redescubre mensajes de chats sin
            # lead cada ciclo y un warning por chat cada 10s inunda el log.
            logger.debug("Evento de automatización ignorado: lead %s no existe", lead_id)
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
                ).on_conflict_do_nothing(
                    index_elements=[AutomationExecution.rule_id, AutomationExecution.event_key]
                )
            )
            created += result.rowcount
        await session.commit()
    if created:
        await manager.broadcast({"type": "automations_updated"})
    return created


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


async def _matches_conditions(rule: AutomationRule, chat: dict) -> tuple[bool, str | None]:
    conditions = rule.conditions or {}
    if conditions.get("stage") and chat.get("stage") != conditions["stage"]:
        return False, "La etapa no coincide"
    if conditions.get("origin_contains") and conditions["origin_contains"].lower() not in (chat.get("origen") or "").lower():
        return False, "El origen no coincide"
    if conditions.get("service_contains") and conditions["service_contains"].lower() not in (chat.get("servicio_interes") or "").lower():
        return False, "El servicio no coincide"
    if conditions.get("seller_id") and chat.get("vendedor_id") != conditions["seller_id"]:
        return False, "El vendedor no coincide"
    if conditions.get("tag_id") and conditions["tag_id"] not in {tag["id"] for tag in chat.get("tags", [])}:
        return False, "La etiqueta no está asignada"
    if conditions.get("require_open_window"):
        window = await get_customer_service_window(chat["chat_id"])
        if not window or not window["is_open"]:
            return False, "La ventana de WhatsApp está cerrada"
    if conditions.get("business_hours_only"):
        local_now = datetime.now(ZoneInfo("America/Lima"))
        if local_now.weekday() >= 5 or not 8 <= local_now.hour < 18:
            return False, "Fuera del horario laboral (lunes a viernes, 08:00–18:00)"
    return True, None


async def _matches_flow_condition(data: dict, chat: dict) -> tuple[bool, str]:
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
        window = await get_customer_service_window(chat["chat_id"])
        matches = bool(window and window["is_open"])
        return matches, "Ventana de WhatsApp abierta" if matches else "Ventana de WhatsApp cerrada"
    local_now = datetime.now(ZoneInfo("America/Lima"))
    matches = local_now.weekday() < 5 and 8 <= local_now.hour < 18
    return matches, "Dentro del horario laboral" if matches else "Fuera del horario laboral"


def _flow_indexes(definition: dict) -> tuple[dict[str, dict], dict[tuple[str, str], str]]:
    nodes = {node["id"]: node for node in definition.get("nodes", [])}
    edges = {
        (edge["source"], edge.get("source_handle") or FlowHandle.NEXT): edge["target"]
        for edge in definition.get("edges", [])
    }
    return nodes, edges


async def simulate_visual_flow(rule_id: int, lead_id: str) -> dict:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != AutomationBuilderMode.VISUAL:
        raise ValueError("Flujo visual no encontrado")
    validated = await validate_visual_flow(current["name"], current["flow_definition"])
    chat = await fetch_chat(lead_id)
    if not chat:
        raise ValueError("Lead no encontrado")
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
                "minutes": node["data"]["minutes"],
            })
            current_id = edges[(current_id, FlowHandle.NEXT)]
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


async def _resolve_recipient(action: dict, chat: dict, payload: dict) -> int:
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


async def _execute_action(action: dict, chat: dict, execution: AutomationExecution, rule: AutomationRule) -> dict:
    action_type = action["type"]
    if action_type == AutomationActionType.CREATE_TASK:
        assigned_user_id = action.get("assigned_user_id") or chat.get("vendedor_id") or execution.event_payload.get("assigned_user_id")
        if not assigned_user_id:
            raise ValueError("No se puede crear la tarea porque el lead no tiene vendedor")
        now = datetime.now(timezone.utc)
        due_at = now + timedelta(minutes=action["due_minutes"])
        remind_at = due_at - timedelta(minutes=action["remind_minutes_before"]) if action["remind_minutes_before"] else None
        task = await create_task({
            "lead_id": chat["chat_id"],
            "title": _render(action["title"], chat),
            "description": _render(action["description"], chat) if action.get("description") else None,
            "task_type": action["task_type"],
            "priority": action["priority"],
            "due_at": due_at,
            "remind_at": remind_at,
            "assigned_user_id": assigned_user_id,
        }, rule.created_by_user_id)
        await manager.broadcast({"type": "tasks_updated"})
        return {
            "type": action_type,
            "status": AutomationExecutionStatus.COMPLETED,
            "task_id": task["id"],
        }
    if action_type == AutomationActionType.ASSIGN_SELLER:
        updated = await update_lead(
            chat["chat_id"], {"vendedor_id": action["user_id"]}, "system", rule.created_by_user_id
        )
        if not updated:
            raise ValueError("Lead no encontrado")
        chat.update(updated)
        await manager.broadcast({"type": "chats_updated"})
        return {
            "type": action_type,
            "status": AutomationExecutionStatus.COMPLETED,
            "user_id": action["user_id"],
        }
    if action_type == AutomationActionType.ADD_TAG:
        if not await assign_tag(chat["chat_id"], action["tag_id"], rule.created_by_user_id):
            raise ValueError("Lead o etiqueta no encontrado")
        await manager.broadcast({"type": "chats_updated"})
        return {
            "type": action_type,
            "status": AutomationExecutionStatus.COMPLETED,
            "tag_id": action["tag_id"],
        }
    if action_type == AutomationActionType.REMOVE_TAG:
        removed = await remove_tag(chat["chat_id"], action["tag_id"], rule.created_by_user_id)
        return {
            "type": action_type,
            "status": (
                AutomationExecutionStatus.COMPLETED
                if removed
                else AutomationExecutionStatus.SKIPPED
            ),
            "tag_id": action["tag_id"],
        }
    if action_type == AutomationActionType.CHANGE_STAGE:
        updated = await update_lead_stage(
            chat["chat_id"], LeadStage(action["stage"]), "system", rule.created_by_user_id,
            {"automation_rule_id": rule.id, "automation_execution_id": execution.id},
        )
        if not updated:
            raise ValueError("Lead no encontrado")
        chat.update(updated)
        await manager.broadcast({"type": "chats_updated"})
        return {
            "type": action_type,
            "status": AutomationExecutionStatus.COMPLETED,
            "stage": action["stage"],
        }
    if action_type == AutomationActionType.NOTIFY:
        user_id = await _resolve_recipient(action, chat, execution.event_payload or {})
        notification = await create_system_notification(
            user_id,
            NotificationType.AUTOMATION,
            _render(action["title"], chat),
            _render(action["body"], chat),
            chat["chat_id"],
            str(execution.id),
            {"automation_rule_id": rule.id, "automation_rule_name": rule.name},
        )
        await manager.send_to_user(user_id, {"type": "notification_created", "notification": notification})
        return {
            "type": action_type,
            "status": AutomationExecutionStatus.COMPLETED,
            "notification_id": notification["id"],
            "user_id": user_id,
        }
    async with get_sessionmaker()() as session:
        template = await session.get(MessageTemplate, action["template_id"])
        attachment_count = await session.scalar(
            select(func.count(TemplateAttachment.id)).where(TemplateAttachment.template_id == action["template_id"])
        )
    if not template or not template.is_active or template.template_type != "internal" or template.interactive_type != "none" or attachment_count:
        raise ValueError("La plantilla automática dejó de ser una plantilla interna de texto válida")
    window = await get_customer_service_window(chat["chat_id"])
    if not window or not window["is_open"]:
        raise ValueError("No se envió WhatsApp porque la ventana de 24 horas está cerrada")
    text = _render(template.content, chat).strip()
    if not text or len(text) > 4096:
        raise ValueError("El contenido renderizado de la plantilla no es válido")
    response = await send_whatsapp_text(chat["chat_id"], text)
    message = await insert_message(
        chat["chat_id"], "vendedor", text,
        wa_message_id=_wa_message_id(response), status="SERVER_ACK",
    )
    await record_template_use(template.id, rule.created_by_user_id)
    await manager.broadcast({"type": "chats_updated"})
    return {
        "type": action_type,
        "status": AutomationExecutionStatus.COMPLETED,
        "message_id": message["id"],
        "template_id": template.id,
    }


async def _persist_visual_execution(
    execution_id: int,
    status: AutomationExecutionStatus,
    results: list[dict],
    current_node_id: str | None,
    path: list[str],
    flow_version: int,
    error: str | None = None,
    scheduled_for: datetime | None = None,
) -> None:
    values = {
        "status": status,
        "action_results": results,
        "flow_state": {
            "flow_version": flow_version,
            "current_node_id": current_node_id,
            "path": path,
        },
        "error": error,
    }
    if status in {
        AutomationExecutionStatus.COMPLETED,
        AutomationExecutionStatus.FAILED,
        AutomationExecutionStatus.SKIPPED,
    }:
        values["finished_at"] = datetime.now(timezone.utc)
    if scheduled_for is not None:
        values["scheduled_for"] = scheduled_for
        values["started_at"] = None
        values["finished_at"] = None
    async with get_sessionmaker()() as session:
        await session.execute(update(AutomationExecution).where(
            AutomationExecution.id == execution_id
        ).values(**values))
        await session.commit()


async def _notify_execution_failure(rule: AutomationRule, execution: AutomationExecution, error: str) -> None:
    """Avisa al admin que creó la regla cuando una ejecución queda en failed —
    sin esto los fallos solo se descubren entrando al historial a mirar."""
    try:
        notification = await create_system_notification(
            rule.created_by_user_id,
            NotificationType.AUTOMATION,
            f"Automatización con error: {rule.name}"[:160],
            (error or "La ejecución falló")[:1000],
            execution.lead_id,
            f"execution-failed:{execution.id}",
            {"automation_rule_id": rule.id, "automation_execution_id": execution.id},
        )
        await manager.send_to_user(
            rule.created_by_user_id, {"type": "notification_created", "notification": notification}
        )
    except Exception:
        logger.exception("No se pudo notificar el fallo de la ejecución %s", execution.id)


async def _resolve_flow_definition(rule: AutomationRule, state: dict, flow_version: int) -> dict:
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


async def _run_visual_execution(execution: AutomationExecution, rule: AutomationRule, chat: dict) -> None:
    state = execution.flow_state or {}
    flow_version = int(state.get("flow_version") or rule.flow_version or 0)
    definition = await _resolve_flow_definition(rule, state, flow_version)
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
        )
        return
    path = list(state.get("path") or [])
    results = list(execution.action_results or [])
    current_id = state.get("current_node_id")
    if not current_id:
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
                await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                )
                continue
            if node["type"] == FlowNodeType.CONDITION:
                matches, detail = await _matches_flow_condition(node["data"], chat)
                branch = FlowHandle.YES if matches else FlowHandle.NO
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": FlowNodeType.CONDITION,
                    "status": AutomationExecutionStatus.COMPLETED,
                    "branch": branch,
                    "detail": detail,
                })
                current_id = edges[(current_id, branch)]
                await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                )
                continue
            if node["type"] == FlowNodeType.ACTION:
                action = node["data"]["action"]
                result = await _execute_action(action, chat, execution, rule)
                results.append({"position": len(results) + 1, "node_id": node["id"], **result})
                current_id = edges[(current_id, FlowHandle.NEXT)]
                await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.RUNNING,
                    results,
                    current_id,
                    path,
                    flow_version,
                )
                continue
            if node["type"] == FlowNodeType.WAIT:
                minutes = node["data"]["minutes"]
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": FlowNodeType.WAIT,
                    "status": AutomationExecutionStatus.SCHEDULED,
                    "minutes": minutes,
                })
                current_id = edges[(current_id, FlowHandle.NEXT)]
                await _persist_visual_execution(
                    execution.id,
                    AutomationExecutionStatus.SCHEDULED,
                    results,
                    current_id,
                    path,
                    flow_version,
                    scheduled_for=datetime.now(timezone.utc) + timedelta(minutes=minutes),
                )
                return
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
        )
        await _notify_execution_failure(rule, execution, str(exc))
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
        )
        await _notify_execution_failure(rule, execution, str(exc))


async def _run_execution(execution_id: int) -> None:
    async with get_sessionmaker()() as session:
        execution = await session.get(AutomationExecution, execution_id)
        rule = await session.get(AutomationRule, execution.rule_id) if execution else None
    if not execution or not rule:
        return
    now = datetime.now(timezone.utc)
    if not rule.is_active:
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(
                status=AutomationExecutionStatus.SKIPPED,
                error="La regla fue desactivada",
                finished_at=now,
            ))
            await session.commit()
        return
    chat = await fetch_chat(execution.lead_id) if execution.lead_id else None
    if not chat:
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(
                status=AutomationExecutionStatus.FAILED,
                error="Lead no encontrado",
                finished_at=now,
            ))
            await session.commit()
        await _notify_execution_failure(rule, execution, "Lead no encontrado")
        return
    if rule.builder_mode == AutomationBuilderMode.VISUAL:
        await _run_visual_execution(execution, rule, chat)
        return
    results = list(execution.action_results or [])
    if not results:
        # Solo se evalúan condiciones en el primer intento: al reanudar una
        # ejecución interrumpida las acciones ya corridas pudieron cambiar el
        # estado del lead y un skip aquí dejaría la regla a medias.
        matches, reason = await _matches_conditions(rule, chat)
        if not matches:
            async with get_sessionmaker()() as session:
                await session.execute(update(AutomationExecution).where(
                    AutomationExecution.id == execution_id
                ).values(
                    status=AutomationExecutionStatus.SKIPPED,
                    error=reason,
                    finished_at=datetime.now(timezone.utc),
                ))
                await session.commit()
            return
    actions = list(rule.actions or [])
    try:
        # Reanuda desde la primera acción sin resultado persistido — un
        # reintento tras un crash no repite WhatsApps ni tareas ya creadas.
        for index in range(len(results), len(actions)):
            result = await _execute_action(actions[index], chat, execution, rule)
            results.append({"position": index + 1, **result})
            async with get_sessionmaker()() as session:
                await session.execute(update(AutomationExecution).where(
                    AutomationExecution.id == execution_id
                ).values(action_results=results))
                await session.commit()
    except (ValueError, EvolutionApiError, httpx.HTTPError) as exc:
        failed_type = actions[len(results)].get("type") if len(results) < len(actions) else None
        results.append({
            "position": len(results) + 1,
            "type": failed_type,
            "status": AutomationExecutionStatus.FAILED,
            "error": str(exc),
        })
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(
                status=AutomationExecutionStatus.FAILED,
                action_results=results,
                error=str(exc),
                finished_at=datetime.now(timezone.utc),
            ))
            await session.commit()
        await _notify_execution_failure(rule, execution, str(exc))
    except Exception as exc:
        logger.exception("Unexpected error running automation execution %s", execution_id)
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(
                status=AutomationExecutionStatus.FAILED,
                action_results=results,
                error=str(exc),
                finished_at=datetime.now(timezone.utc),
            ))
            await session.commit()
        await _notify_execution_failure(rule, execution, str(exc))
    else:
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(
                status=AutomationExecutionStatus.COMPLETED,
                action_results=results,
                error=None,
                finished_at=datetime.now(timezone.utc),
            ))
            await session.commit()


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
                attempts=AutomationExecution.attempts + 1,
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
    while True:
        try:
            await _release_stale_executions()
            await _discover_recent_inbound_messages()
            await _discover_timed_events()
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
