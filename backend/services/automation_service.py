import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import (
    AutomationExecution,
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
TRIGGER_TYPES = {
    "lead_created",
    "stage_changed",
    "message_received",
    "seller_response_overdue",
    "customer_response_overdue",
    "task_due",
}
ACTION_TYPES = {
    "create_task",
    "assign_seller",
    "add_tag",
    "remove_tag",
    "change_stage",
    "notify",
    "send_template",
}
FLOW_NODE_TYPES = {"trigger", "condition", "action", "wait", "end"}
FLOW_CONDITION_TYPES = {
    "stage_equals", "origin_contains", "service_contains", "seller_equals",
    "tag_present", "whatsapp_window_open", "business_hours",
}
MAX_FLOW_NODES = 50
MAX_FLOW_EDGES = 80
CRM_VARIABLES = {"nombre", "telefono", "servicio", "vendedor", "fecha_actual"}


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
        "builder_mode": row["builder_mode"] or "simple",
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
    if trigger_type in {"seller_response_overdue", "customer_response_overdue"}:
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
        if action_type == "create_task":
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
                "task_type": raw.get("task_type") if raw.get("task_type") in {"whatsapp", "llamada", "cotizacion", "cita", "seguimiento", "otro"} else "seguimiento",
                "priority": raw.get("priority") if raw.get("priority") in {"low", "normal", "high"} else "normal",
                "due_minutes": due_minutes,
                "remind_minutes_before": remind_before,
                "assigned_user_id": assignee,
            })
        elif action_type == "assign_seller":
            user_id = int(raw.get("user_id") or 0)
            if not user_id:
                raise ValueError(f"Acción {position}: selecciona un vendedor")
            referenced_users.add(user_id)
            normalized_actions.append({"type": action_type, "user_id": user_id})
        elif action_type in {"add_tag", "remove_tag"}:
            tag_id = int(raw.get("tag_id") or 0)
            if not tag_id:
                raise ValueError(f"Acción {position}: selecciona una etiqueta")
            referenced_tags.add(tag_id)
            normalized_actions.append({"type": action_type, "tag_id": tag_id})
        elif action_type == "change_stage":
            stage = str(raw.get("stage") or "")
            if stage not in {item.value for item in LeadStage}:
                raise ValueError(f"Acción {position}: etapa inválida")
            normalized_actions.append({"type": action_type, "stage": stage})
        elif action_type == "notify":
            title = str(raw.get("title") or "").strip()
            body = str(raw.get("body") or "").strip()
            recipient = raw.get("recipient") if raw.get("recipient") in {"seller", "specific"} else "seller"
            user_id = int(raw.get("user_id") or 0) if recipient == "specific" else None
            if not title or not body or len(title) > 160 or len(body) > 1000:
                raise ValueError(f"Acción {position}: título o contenido de notificación inválido")
            if recipient == "specific" and not user_id:
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
    if condition_type == "stage_equals":
        value = str(value or "")
        if value not in {stage.value for stage in LeadStage}:
            raise ValueError(f"Condición {position}: etapa inválida")
    elif condition_type in {"origin_contains", "service_contains"}:
        value = str(value or "").strip()
        if not value or len(value) > 120:
            raise ValueError(f"Condición {position}: escribe un valor de hasta 120 caracteres")
    elif condition_type == "seller_equals":
        user_id = int(value or 0)
        if not user_id:
            raise ValueError(f"Condición {position}: selecciona un vendedor")
        value = user_id
    elif condition_type == "tag_present":
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
        handle = str(raw_edge.get("source_handle") or "next")
        edge_id = str(raw_edge.get("id") or f"{source}:{handle}:{target}")[:160]
        if source not in ids or target not in ids or source == target:
            raise ValueError(f"Conexión {position}: origen o destino inválido")
        if handle not in {"next", "yes", "no"} or edge_id in edge_ids:
            raise ValueError(f"Conexión {position}: salida o identificador inválido")
        edge_ids.add(edge_id)
        edges.append({"id": edge_id, "source": source, "target": target, "source_handle": handle})
    trigger = next((node for node in nodes if node["type"] == "trigger"), None)
    trigger_data = trigger["data"] if trigger else {}
    trigger_type = trigger_data.get("trigger_type") if trigger_data.get("trigger_type") in TRIGGER_TYPES else "lead_created"
    trigger_config = {}
    if trigger_type in {"seller_response_overdue", "customer_response_overdue"}:
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
        if node_type == "trigger":
            trigger_type = data.get("trigger_type")
            trigger_config = {"minutes": data.get("minutes")} if trigger_type in {"seller_response_overdue", "customer_response_overdue"} else {}
            trigger_values = await validate_automation_rule({
                "name": name, "trigger_type": trigger_type, "trigger_config": trigger_config,
                "conditions": {}, "actions": [{"type": "change_stage", "stage": "nuevo"}],
                "delay_minutes": 0, "is_active": False,
            })
            normalized_data = {
                "trigger_type": trigger_values["trigger_type"],
                "minutes": trigger_values["trigger_config"].get("minutes"),
            }
            trigger_nodes.append({"id": node_id, "data": normalized_data})
        elif node_type == "condition":
            normalized_data, user_id, tag_id = _normalize_flow_condition(data, position)
            if user_id:
                condition_users.add(user_id)
            if tag_id:
                condition_tags.add(tag_id)
        elif node_type == "action":
            action = data.get("action") if isinstance(data.get("action"), dict) else {}
            normalized_data = {"action": action}
            action_nodes.append((len(normalized_nodes), action))
        elif node_type == "wait":
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
        handle = str(raw_edge.get("source_handle") or "next")
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
        if node["type"] == "end":
            if edges:
                raise ValueError("Un bloque Fin no puede tener conexiones de salida")
        elif node["type"] == "condition":
            handles = [edge["source_handle"] for edge in edges]
            if sorted(handles) != ["no", "yes"]:
                raise ValueError("Cada condición debe tener exactamente una salida Sí y una salida No")
        elif len(edges) != 1 or edges[0]["source_handle"] != "next":
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
            builder_mode="visual", flow_definition=validated["flow_definition"],
            published_flow_definition=None, flow_version=0,
            created_by_user_id=user_id, created_at=now, updated_at=now,
        ).returning(AutomationRule.id))).scalar_one()
        await session.commit()
    return await get_automation_rule(rule_id)


async def save_visual_flow(rule_id: int, name: str, definition: dict) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != "visual":
        return None
    validated = normalize_visual_draft(name, definition)
    return await update_automation_rule(rule_id, {
        "name": validated["name"],
        "flow_definition": validated["flow_definition"],
    })


async def publish_visual_flow(rule_id: int) -> dict | None:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != "visual":
        return None
    validated = await validate_visual_flow(current["name"], current["flow_definition"])
    return await update_automation_rule(rule_id, {
        "name": validated["name"],
        "trigger_type": validated["trigger_type"],
        "trigger_config": validated["trigger_config"],
        "flow_definition": validated["flow_definition"],
        "published_flow_definition": validated["flow_definition"],
        "flow_version": current["flow_version"] + 1,
        "is_active": True,
    })


async def schedule_automation_event(
    trigger_type: str,
    lead_id: str,
    event_key: str,
    payload: dict | None = None,
    rule_id: int | None = None,
) -> int:
    if trigger_type not in TRIGGER_TYPES:
        return 0
    stmt = select(
        AutomationRule.id, AutomationRule.delay_minutes, AutomationRule.builder_mode,
        AutomationRule.published_flow_definition, AutomationRule.flow_version,
    ).where(
        AutomationRule.is_active.is_(True), AutomationRule.trigger_type == trigger_type
    )
    if rule_id is not None:
        stmt = stmt.where(AutomationRule.id == rule_id)
    async with get_sessionmaker()() as session:
        if await session.get(Lead, lead_id) is None:
            logger.warning("Evento de automatización ignorado: lead %s no existe", lead_id)
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
                    status="scheduled",
                    scheduled_for=now + timedelta(minutes=rule["delay_minutes"]),
                    action_results=[],
                    flow_state={
                        "definition": rule["published_flow_definition"],
                        "flow_version": rule["flow_version"],
                        "current_node_id": None,
                        "path": [],
                    } if rule["builder_mode"] == "visual" else {},
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
                LeadActivity.lead_id == lead_id, LeadActivity.event_type == "lead_created"
            ).order_by(LeadActivity.id.desc()).limit(1)
        )
    await schedule_automation_event("lead_created", lead_id, f"lead:{activity_id or lead_id}")
    await process_due_automation_executions()


async def trigger_stage_changed(lead_id: str) -> None:
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(LeadActivity.id, LeadActivity.old_value, LeadActivity.new_value).where(
                LeadActivity.lead_id == lead_id, LeadActivity.event_type == "stage_changed"
            ).order_by(LeadActivity.id.desc()).limit(1)
        )).mappings().first()
    if row:
        await schedule_automation_event(
            "stage_changed", lead_id, f"stage:{row['id']}",
            {"old_value": row["old_value"], "new_value": row["new_value"]},
        )
        await process_due_automation_executions()


async def trigger_inbound_message(message: dict) -> None:
    if message.get("sender") != "cliente" or not message.get("chat_id"):
        return
    lead_id = message["chat_id"]
    message_key = str(message.get("message_id") or "")
    if not message_key:
        return
    await schedule_automation_event(
        "message_received", lead_id, f"message:{message_key}",
        {"message_id": message_key, "content": message.get("content")},
    )
    async with get_sessionmaker()() as session:
        message_count = await session.scalar(
            select(func.count(WspMessage.id)).where(WspMessage.chat_id == lead_id)
        )
        has_recorded_creation = await session.scalar(
            select(LeadActivity.id).where(
                LeadActivity.lead_id == lead_id,
                LeadActivity.event_type == "lead_created",
            ).limit(1)
        )
    if message_count == 1 and not has_recorded_creation:
        await schedule_automation_event(
            "lead_created", lead_id, f"lead:first-message:{message_key}",
            {"source": "first_inbound_message"},
        )
    await process_due_automation_executions()


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
    if condition_type == "stage_equals":
        matches = chat.get("stage") == value
        return matches, f"Etapa {'coincide' if matches else 'no coincide'} con {value}"
    if condition_type == "origin_contains":
        matches = str(value).lower() in (chat.get("origen") or "").lower()
        return matches, f"Origen {'contiene' if matches else 'no contiene'} {value}"
    if condition_type == "service_contains":
        matches = str(value).lower() in (chat.get("servicio_interes") or "").lower()
        return matches, f"Servicio {'contiene' if matches else 'no contiene'} {value}"
    if condition_type == "seller_equals":
        matches = chat.get("vendedor_id") == value
        return matches, "Vendedor coincide" if matches else "Vendedor no coincide"
    if condition_type == "tag_present":
        matches = value in {tag["id"] for tag in chat.get("tags", [])}
        return matches, "Etiqueta presente" if matches else "Etiqueta ausente"
    if condition_type == "whatsapp_window_open":
        window = await get_customer_service_window(chat["chat_id"])
        matches = bool(window and window["is_open"])
        return matches, "Ventana de WhatsApp abierta" if matches else "Ventana de WhatsApp cerrada"
    local_now = datetime.now(ZoneInfo("America/Lima"))
    matches = local_now.weekday() < 5 and 8 <= local_now.hour < 18
    return matches, "Dentro del horario laboral" if matches else "Fuera del horario laboral"


def _flow_indexes(definition: dict) -> tuple[dict[str, dict], dict[tuple[str, str], str]]:
    nodes = {node["id"]: node for node in definition.get("nodes", [])}
    edges = {
        (edge["source"], edge.get("source_handle") or "next"): edge["target"]
        for edge in definition.get("edges", [])
    }
    return nodes, edges


async def simulate_visual_flow(rule_id: int, lead_id: str) -> dict:
    current = await get_automation_rule(rule_id)
    if current is None or current["builder_mode"] != "visual":
        raise ValueError("Flujo visual no encontrado")
    validated = await validate_visual_flow(current["name"], current["flow_definition"])
    chat = await fetch_chat(lead_id)
    if not chat:
        raise ValueError("Lead no encontrado")
    nodes, edges = _flow_indexes(validated["flow_definition"])
    trigger = next(node for node in nodes.values() if node["type"] == "trigger")
    current_id = trigger["id"]
    path: list[dict] = []
    for _ in range(MAX_FLOW_NODES + 1):
        node = nodes[current_id]
        if node["type"] == "trigger":
            path.append({"node_id": current_id, "type": "trigger", "status": "matched"})
            current_id = edges[(current_id, "next")]
        elif node["type"] == "condition":
            matches, detail = await _matches_flow_condition(node["data"], chat)
            branch = "yes" if matches else "no"
            path.append({
                "node_id": current_id, "type": "condition", "status": "evaluated",
                "branch": branch, "detail": detail,
            })
            current_id = edges[(current_id, branch)]
        elif node["type"] == "action":
            action = node["data"]["action"]
            result = {"node_id": current_id, "type": action["type"], "status": "would_run"}
            if action["type"] == "send_template":
                window = await get_customer_service_window(chat["chat_id"])
                if not window or not window["is_open"]:
                    result.update(status="would_fail", detail="La ventana de 24 horas está cerrada")
            path.append(result)
            current_id = edges[(current_id, "next")]
        elif node["type"] == "wait":
            path.append({
                "node_id": current_id, "type": "wait", "status": "would_wait",
                "minutes": node["data"]["minutes"],
            })
            current_id = edges[(current_id, "next")]
        else:
            path.append({"node_id": current_id, "type": "end", "status": "completed"})
            return {
                "lead_id": chat["chat_id"], "lead_name": chat.get("name"),
                "flow_version": current["flow_version"], "path": path,
            }
    raise ValueError("La simulación excedió el máximo de bloques")


async def _resolve_recipient(action: dict, chat: dict, payload: dict) -> int:
    if action.get("recipient") == "specific" and action.get("user_id"):
        return int(action["user_id"])
    if chat.get("vendedor_id"):
        return int(chat["vendedor_id"])
    if payload.get("assigned_user_id"):
        return int(payload["assigned_user_id"])
    raise ValueError("El lead no tiene vendedor asignado")


async def _execute_action(action: dict, chat: dict, execution: AutomationExecution, rule: AutomationRule) -> dict:
    action_type = action["type"]
    if action_type == "create_task":
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
        return {"type": action_type, "status": "completed", "task_id": task["id"]}
    if action_type == "assign_seller":
        updated = await update_lead(
            chat["chat_id"], {"vendedor_id": action["user_id"]}, "system", rule.created_by_user_id
        )
        if not updated:
            raise ValueError("Lead no encontrado")
        chat.update(updated)
        await manager.broadcast({"type": "chats_updated"})
        return {"type": action_type, "status": "completed", "user_id": action["user_id"]}
    if action_type == "add_tag":
        if not await assign_tag(chat["chat_id"], action["tag_id"], rule.created_by_user_id):
            raise ValueError("Lead o etiqueta no encontrado")
        await manager.broadcast({"type": "chats_updated"})
        return {"type": action_type, "status": "completed", "tag_id": action["tag_id"]}
    if action_type == "remove_tag":
        removed = await remove_tag(chat["chat_id"], action["tag_id"], rule.created_by_user_id)
        return {"type": action_type, "status": "completed" if removed else "skipped", "tag_id": action["tag_id"]}
    if action_type == "change_stage":
        updated = await update_lead_stage(
            chat["chat_id"], LeadStage(action["stage"]), "system", rule.created_by_user_id,
            {"automation_rule_id": rule.id, "automation_execution_id": execution.id},
        )
        if not updated:
            raise ValueError("Lead no encontrado")
        chat.update(updated)
        await manager.broadcast({"type": "chats_updated"})
        return {"type": action_type, "status": "completed", "stage": action["stage"]}
    if action_type == "notify":
        user_id = await _resolve_recipient(action, chat, execution.event_payload or {})
        notification = await create_system_notification(
            user_id,
            "automation",
            _render(action["title"], chat),
            _render(action["body"], chat),
            chat["chat_id"],
            str(execution.id),
            {"automation_rule_id": rule.id, "automation_rule_name": rule.name},
        )
        await manager.send_to_user(user_id, {"type": "notification_created", "notification": notification})
        return {"type": action_type, "status": "completed", "notification_id": notification["id"], "user_id": user_id}
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
    return {"type": action_type, "status": "completed", "message_id": message["id"], "template_id": template.id}


async def _persist_visual_execution(
    execution_id: int,
    status: str,
    results: list[dict],
    current_node_id: str | None,
    path: list[str],
    definition: dict,
    flow_version: int,
    error: str | None = None,
    scheduled_for: datetime | None = None,
) -> None:
    values = {
        "status": status,
        "action_results": results,
        "flow_state": {
            "definition": definition,
            "flow_version": flow_version,
            "current_node_id": current_node_id,
            "path": path,
        },
        "error": error,
    }
    if status in {"completed", "failed", "skipped"}:
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


async def _run_visual_execution(execution: AutomationExecution, rule: AutomationRule, chat: dict) -> None:
    state = execution.flow_state or {}
    definition = state.get("definition") or rule.published_flow_definition or {}
    flow_version = int(state.get("flow_version") or rule.flow_version or 0)
    nodes, edges = _flow_indexes(definition)
    if not nodes:
        await _persist_visual_execution(
            execution.id, "failed", execution.action_results or [], None, [], definition, flow_version,
            "El flujo no tiene una versión publicada",
        )
        return
    path = list(state.get("path") or [])
    results = list(execution.action_results or [])
    current_id = state.get("current_node_id")
    if not current_id:
        trigger = next((node for node in nodes.values() if node["type"] == "trigger"), None)
        current_id = trigger["id"] if trigger else None
    try:
        for _ in range(MAX_FLOW_NODES + 1):
            if not current_id or current_id not in nodes:
                raise ValueError("El flujo perdió la referencia al siguiente bloque")
            node = nodes[current_id]
            path.append(current_id)
            if node["type"] == "trigger":
                current_id = edges[(current_id, "next")]
                await _persist_visual_execution(execution.id, "running", results, current_id, path, definition, flow_version)
                continue
            if node["type"] == "condition":
                matches, detail = await _matches_flow_condition(node["data"], chat)
                branch = "yes" if matches else "no"
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": "condition", "status": "completed", "branch": branch,
                    "detail": detail,
                })
                current_id = edges[(current_id, branch)]
                await _persist_visual_execution(execution.id, "running", results, current_id, path, definition, flow_version)
                continue
            if node["type"] == "action":
                action = node["data"]["action"]
                result = await _execute_action(action, chat, execution, rule)
                results.append({"position": len(results) + 1, "node_id": node["id"], **result})
                current_id = edges[(current_id, "next")]
                await _persist_visual_execution(execution.id, "running", results, current_id, path, definition, flow_version)
                continue
            if node["type"] == "wait":
                minutes = node["data"]["minutes"]
                results.append({
                    "position": len(results) + 1, "node_id": node["id"],
                    "type": "wait", "status": "scheduled", "minutes": minutes,
                })
                current_id = edges[(current_id, "next")]
                await _persist_visual_execution(
                    execution.id, "scheduled", results, current_id, path, definition, flow_version,
                    scheduled_for=datetime.now(timezone.utc) + timedelta(minutes=minutes),
                )
                return
            results.append({
                "position": len(results) + 1, "node_id": node["id"],
                "type": "end", "status": "completed",
            })
            await _persist_visual_execution(execution.id, "completed", results, None, path, definition, flow_version)
            return
        raise ValueError("El flujo excedió el máximo de bloques permitidos")
    except (KeyError, ValueError, EvolutionApiError, httpx.HTTPError) as exc:
        action_type = "flow"
        if current_id in nodes and nodes[current_id]["type"] == "action":
            action_type = nodes[current_id]["data"].get("action", {}).get("type", "action")
        results.append({
            "position": len(results) + 1, "node_id": current_id,
            "type": action_type, "status": "failed", "error": str(exc),
        })
        await _persist_visual_execution(execution.id, "failed", results, current_id, path, definition, flow_version, str(exc))
    except Exception as exc:
        logger.exception("Unexpected error running visual automation execution %s", execution.id)
        await _persist_visual_execution(execution.id, "failed", results, current_id, path, definition, flow_version, str(exc))


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
            ).values(status="skipped", error="La regla fue desactivada", finished_at=now))
            await session.commit()
        return
    chat = await fetch_chat(execution.lead_id) if execution.lead_id else None
    if not chat:
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(status="failed", error="Lead no encontrado", finished_at=now))
            await session.commit()
        return
    if rule.builder_mode == "visual":
        await _run_visual_execution(execution, rule, chat)
        return
    matches, reason = await _matches_conditions(rule, chat)
    if not matches:
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(status="skipped", error=reason, finished_at=datetime.now(timezone.utc)))
            await session.commit()
        return
    results: list[dict] = []
    try:
        for index, action in enumerate(rule.actions or [], start=1):
            result = await _execute_action(action, chat, execution, rule)
            results.append({"position": index, **result})
    except (ValueError, EvolutionApiError, httpx.HTTPError) as exc:
        results.append({"position": len(results) + 1, "type": (rule.actions or [])[len(results)].get("type"), "status": "failed", "error": str(exc)})
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(status="failed", action_results=results, error=str(exc), finished_at=datetime.now(timezone.utc)))
            await session.commit()
    except Exception as exc:
        logger.exception("Unexpected error running automation execution %s", execution_id)
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(status="failed", action_results=results, error=str(exc), finished_at=datetime.now(timezone.utc)))
            await session.commit()
    else:
        async with get_sessionmaker()() as session:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id == execution_id
            ).values(status="completed", action_results=results, error=None, finished_at=datetime.now(timezone.utc)))
            await session.commit()


async def process_due_automation_executions(limit: int = 20) -> int:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        ids = (await session.execute(
            select(AutomationExecution.id).where(
                AutomationExecution.status == "scheduled",
                AutomationExecution.scheduled_for <= now,
            ).order_by(AutomationExecution.scheduled_for.asc()).limit(limit).with_for_update(skip_locked=True)
        )).scalars().all()
        if ids:
            await session.execute(update(AutomationExecution).where(
                AutomationExecution.id.in_(ids)
            ).values(status="running", started_at=now, error=None))
        await session.commit()
    for execution_id in ids:
        await _run_execution(execution_id)
    if ids:
        await manager.broadcast({"type": "automations_updated"})
    return len(ids)


async def _discover_recent_inbound_messages() -> None:
    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(WspMessage.id, WspMessage.wa_message_id, WspMessage.chat_id, WspMessage.content).where(
                WspMessage.sender == "cliente", WspMessage.sent_at >= since
            ).order_by(WspMessage.sent_at.asc(), WspMessage.id.asc()).limit(200)
        )).mappings().all()
    for row in rows:
        await schedule_automation_event(
            "message_received", row["chat_id"], f"message:{row['wa_message_id'] or row['id']}",
            {"message_id": str(row["wa_message_id"] or row["id"]), "content": row["content"]},
        )


async def _discover_timed_events() -> None:
    async with get_sessionmaker()() as session:
        rules = (await session.execute(select(AutomationRule).where(
            AutomationRule.is_active.is_(True),
            AutomationRule.trigger_type.in_(["seller_response_overdue", "customer_response_overdue", "task_due"]),
        ))).scalars().all()
    for rule in rules:
        if rule.trigger_type == "task_due":
            async with get_sessionmaker()() as session:
                tasks = (await session.execute(select(
                    LeadTask.id, LeadTask.lead_id, LeadTask.assigned_user_id, LeadTask.title,
                    LeadTask.due_at, LeadTask.updated_at,
                ).where(
                    LeadTask.status == "pending", LeadTask.due_at <= datetime.now(timezone.utc)
                ).limit(200))).mappings().all()
            for task in tasks:
                await schedule_automation_event(
                    "task_due", task["lead_id"], f"task:{task['id']}:{_ts(task['updated_at'])}", {
                        "task_id": task["id"],
                        "assigned_user_id": task["assigned_user_id"],
                        "title": task["title"],
                        "due_at": _ts(task["due_at"]),
                    }, rule.id
                )
            continue
        expected_sender = "cliente" if rule.trigger_type == "seller_response_overdue" else "vendedor"
        threshold = datetime.now(timezone.utc) - timedelta(minutes=int((rule.trigger_config or {}).get("minutes", 1)))
        last_message = (
            select(
                WspMessage.id,
                WspMessage.chat_id,
                WspMessage.sender,
                WspMessage.sent_at,
                func.row_number().over(
                    partition_by=WspMessage.chat_id,
                    order_by=(WspMessage.sent_at.desc(), WspMessage.id.desc()),
                ).label("position"),
            ).subquery()
        )
        async with get_sessionmaker()() as session:
            rows = (await session.execute(select(last_message).where(
                last_message.c.position == 1,
                last_message.c.sender == expected_sender,
                last_message.c.sent_at <= threshold,
            ).limit(500))).mappings().all()
        for row in rows:
            await schedule_automation_event(
                rule.trigger_type,
                row["chat_id"],
                f"overdue:{row['id']}",
                {"last_message_id": str(row["id"]), "last_sender": row["sender"], "last_message_at": _ts(row["sent_at"])},
                rule.id,
            )


async def _release_stale_executions() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    async with get_sessionmaker()() as session:
        await session.execute(update(AutomationExecution).where(
            AutomationExecution.status == "running",
            AutomationExecution.started_at < cutoff,
        ).values(status="scheduled", started_at=None, error="Reintentando una ejecución interrumpida"))
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
        await asyncio.sleep(AUTOMATION_POLL_SECONDS)
