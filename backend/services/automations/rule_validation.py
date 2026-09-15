from sqlalchemy import select

from db.models import LeadStage, LeadTag, MediaAsset, MessageTemplate, User
from db.session import get_sessionmaker
from domain_types import (
    AutomationActionType,
    AutomationRecipient,
    AutomationTrigger,
    FlowConditionType,
    TaskPriority,
    TaskType,
    WaitAnyConditionKind,
)
from services.automation_rules import normalize_conditions, normalize_flow_position
from services.automation_scheduling import TRIGGER_TYPES
from services.automations.common import (
    ACTION_TYPES,
    AUTOMATION_RECIPIENTS,
    CONVERSATION_STATES,
    FLOW_CONDITION_TYPES,
    MAX_ACTIONS,
    MAX_CONDITION_GROUPS,
    MAX_CONDITIONS_PER_GROUP,
    MAX_CONDITIONS_PER_NODE,
    MAX_MEDIA_CAPTION_LENGTH,
    MAX_MESSAGE_CONDITION_LENGTH,
    MAX_REACTION_LENGTH,
    MAX_WHATSAPP_TEXT_LENGTH,
    TASK_PRIORITIES,
    TASK_TYPES,
    _unknown_variables,
)

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
        elif action_type == AutomationActionType.SET_CONVERSATION_STATE:
            state = str(raw.get("state") or "")
            if state not in CONVERSATION_STATES:
                raise ValueError(f"Acción {position}: estado de conversación inválido")
            normalized_actions.append({"type": action_type, "state": state})
        elif action_type in {
            AutomationActionType.SEND_AUDIO,
            AutomationActionType.SEND_ATTACHMENT,
            AutomationActionType.SEND_MEDIA,
        }:
            media_asset_id = int(raw.get("media_asset_id") or 0)
            if not media_asset_id:
                raise ValueError(f"Acción {position}: selecciona un archivo de la librería de medios")
            referenced_media_assets.add(media_asset_id)
            normalized = {"type": action_type, "media_asset_id": media_asset_id}
            if action_type == AutomationActionType.SEND_MEDIA:
                caption = str(raw.get("caption") or "").strip()
                if len(caption) > MAX_MEDIA_CAPTION_LENGTH:
                    raise ValueError(
                        f"Acción {position}: el caption admite máximo "
                        f"{MAX_MEDIA_CAPTION_LENGTH} caracteres"
                    )
                normalized["caption"] = caption
            normalized_actions.append(normalized)

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
    ("timer"/"message"/"media_received"/...) porque el diseño admite a lo sumo
    una de cada — no hace falta que el usuario invente identificadores.

    `timer` es obligatorio (nunca puede quedar esperando para siempre); el
    resto son opcionales. `message` y `media_received` conviven: con las dos,
    el texto sale por una y la foto por la otra.
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


MAX_ROUND_ROBIN_OUTPUTS = 10


def _normalize_round_robin(data: dict, position: int) -> dict:
    """Bloque Round robin (`round_robin`): reparte las ejecuciones entre sus
    salidas por turnos. Cada salida es un handle del nodo, con id posicional
    `out_1..out_n` — mismo esquema que los botones de Pregunta, así el handle
    que dibuja el editor es el que queda publicado.
    """
    raw_outputs = data.get("outputs")
    labels = [
        str(raw.get("label") if isinstance(raw, dict) else raw or "").strip()[:40]
        for raw in (raw_outputs if isinstance(raw_outputs, list) else [])
    ]
    if not 2 <= len(labels) <= MAX_ROUND_ROBIN_OUTPUTS:
        raise ValueError(
            f"Round robin {position}: configura entre 2 y {MAX_ROUND_ROBIN_OUTPUTS} salidas"
        )
    return {
        "outputs": [
            {"id": f"out_{index}", "label": label or f"Salida {index}"}
            for index, label in enumerate(labels, start=1)
        ],
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
        FlowConditionType.MESSAGE_CONTAINS,
        FlowConditionType.MESSAGE_EQUALS,
        FlowConditionType.MESSAGE_NOT_CONTAINS,
    }:
        value = str(value or "").strip()
        max_length = (
            MAX_MESSAGE_CONDITION_LENGTH
            if condition_type in {
                FlowConditionType.MESSAGE_CONTAINS,
                FlowConditionType.MESSAGE_EQUALS,
                FlowConditionType.MESSAGE_NOT_CONTAINS,
            }
            else 120
        )
        if not value or len(value) > max_length:
            raise ValueError(f"Condición {position}: escribe un valor de hasta {max_length} caracteres")
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


def _normalize_flow_condition_node(
    data: dict, position: int,
) -> tuple[dict, set[int], set[int]]:
    """Normaliza grupos OR de condiciones AND, aceptando el formato legado.

    `condition_groups`: cualquiera de los grupos puede cumplir (OR); dentro
    de cada grupo deben cumplir todas las condiciones (AND). Un nodo viejo
    con `condition_type`/`value` se convierte en un grupo de una condición.
    """
    raw_groups = data.get("condition_groups")
    if raw_groups is None:
        normalized, user_id, tag_id = _normalize_flow_condition(data, position)
        return {
            "condition_groups": [{
                "id": "group_1",
                "conditions": [{"id": "condition_1", **normalized}],
            }],
        }, ({user_id} if user_id else set()), ({tag_id} if tag_id else set())
    if not isinstance(raw_groups, list) or not 1 <= len(raw_groups) <= MAX_CONDITION_GROUPS:
        raise ValueError(
            f"Condición {position}: configura entre 1 y {MAX_CONDITION_GROUPS} grupos"
        )

    groups: list[dict] = []
    users: set[int] = set()
    tags: set[int] = set()
    group_ids: set[str] = set()
    total_conditions = 0
    for group_position, raw_group in enumerate(raw_groups, start=1):
        if not isinstance(raw_group, dict):
            raise ValueError(f"Condición {position}, grupo {group_position}: formato inválido")
        group_id = str(raw_group.get("id") or f"group_{group_position}").strip()[:80]
        if not group_id or group_id in group_ids:
            raise ValueError(f"Condición {position}: identificador de grupo vacío o duplicado")
        group_ids.add(group_id)
        raw_conditions = raw_group.get("conditions")
        if not isinstance(raw_conditions, list) or not 1 <= len(raw_conditions) <= MAX_CONDITIONS_PER_GROUP:
            raise ValueError(
                f"Condición {position}, grupo {group_position}: configura entre 1 y "
                f"{MAX_CONDITIONS_PER_GROUP} reglas AND"
            )
        condition_ids: set[str] = set()
        conditions: list[dict] = []
        for condition_position, raw_condition in enumerate(raw_conditions, start=1):
            if not isinstance(raw_condition, dict):
                raise ValueError(
                    f"Condición {position}, grupo {group_position}, regla {condition_position}: formato inválido"
                )
            condition_id = str(
                raw_condition.get("id") or f"condition_{condition_position}"
            ).strip()[:80]
            if not condition_id or condition_id in condition_ids:
                raise ValueError(
                    f"Condición {position}, grupo {group_position}: identificador de regla vacío o duplicado"
                )
            condition_ids.add(condition_id)
            normalized, user_id, tag_id = _normalize_flow_condition(raw_condition, position)
            conditions.append({"id": condition_id, **normalized})
            if user_id:
                users.add(user_id)
            if tag_id:
                tags.add(tag_id)
        total_conditions += len(conditions)
        groups.append({"id": group_id, "conditions": conditions})
    if total_conditions > MAX_CONDITIONS_PER_NODE:
        raise ValueError(
            f"Condición {position}: admite hasta {MAX_CONDITIONS_PER_NODE} reglas en total"
        )
    return {"condition_groups": groups}, users, tags
