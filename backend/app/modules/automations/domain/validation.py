"""Normalización de reglas y bloques: la forma de lo que se guarda.

Todo acá es puro. Lo que solo la base puede responder (si un vendedor, una
etiqueta o una plantilla existen y están activos) se junta en
``ActionReferences`` y lo verifica ``application.validation`` de una sola vez.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from app.modules.automations.domain.types import AutomationActionType, AutomationRecipient, AutomationTrigger, FlowConditionType, WaitAnyConditionKind
from app.modules.tasks.ports.types import TaskPriority, TaskType
from app.integrations.meta.contract import limit
from app.modules.automations.domain.limits import (
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
    TRIGGER_TYPES,
)
from app.modules.automations.domain.rules import is_stage_key, normalize_conditions, unknown_variables
from app.modules.automations.domain.errors import InvalidAutomation, rejects_malformed_input

OVERDUE_TRIGGERS = frozenset({
    AutomationTrigger.SELLER_RESPONSE_OVERDUE,
    AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
})


@dataclass
class ActionReferences:
    """Ids que las acciones mencionan y hay que verificar contra la base una
    sola vez al final, en lugar de una consulta por acción."""

    users: set[int] = field(default_factory=set)
    tags: set[int] = field(default_factory=set)
    templates: set[int] = field(default_factory=set)
    media_assets: set[int] = field(default_factory=set)
    # Etapas destino de "cambiar etapa": tienen que existir y estar activas.
    stages: set[str] = field(default_factory=set)
    # Etapas por las que se filtra: alcanza con que existan (filtrar por una
    # etapa desactivada que todavía tiene leads es válido).
    condition_stages: set[str] = field(default_factory=set)


def _normalize_create_task(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    title = str(raw.get("title") or "").strip()
    due_minutes = int(raw.get("due_minutes") or 0)
    remind_before = int(raw.get("remind_minutes_before") or 0)
    if not title or len(title) > 160 or not 1 <= due_minutes <= 43200:
        raise InvalidAutomation(f"Acción {position}: título y vencimiento de tarea inválidos")
    if remind_before < 0 or remind_before >= due_minutes:
        raise InvalidAutomation(f"Acción {position}: el recordatorio debe ser anterior al vencimiento")
    assignee = int(raw["assigned_user_id"]) if raw.get("assigned_user_id") else None
    if assignee:
        refs.users.add(assignee)
    return {
        "type": action_type,
        "title": title,
        "description": str(raw.get("description") or "").strip()[:1000] or None,
        "task_type": raw.get("task_type") if raw.get("task_type") in TASK_TYPES else TaskType.FOLLOW_UP,
        "priority": raw.get("priority") if raw.get("priority") in TASK_PRIORITIES else TaskPriority.NORMAL,
        "due_minutes": due_minutes,
        "remind_minutes_before": remind_before,
        "assigned_user_id": assignee,
    }


def _normalize_assign_seller(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    user_id = int(raw.get("user_id") or 0)
    if not user_id:
        raise InvalidAutomation(f"Acción {position}: selecciona un vendedor")
    refs.users.add(user_id)
    return {"type": action_type, "user_id": user_id}


def _normalize_tag_action(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    tag_id = int(raw.get("tag_id") or 0)
    if not tag_id:
        raise InvalidAutomation(f"Acción {position}: selecciona una etiqueta")
    refs.tags.add(tag_id)
    return {"type": action_type, "tag_id": tag_id}


def _normalize_change_stage(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    stage = str(raw.get("stage") or "")
    if not is_stage_key(stage):
        raise InvalidAutomation(f"Acción {position}: etapa inválida")
    refs.stages.add(stage)
    return {"type": action_type, "stage": stage}


def _normalize_notify(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
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
        raise InvalidAutomation(f"Acción {position}: título o contenido de notificación inválido")
    if recipient == AutomationRecipient.SPECIFIC and not user_id:
        raise InvalidAutomation(f"Acción {position}: selecciona el destinatario")
    if user_id:
        refs.users.add(user_id)
    return {
        "type": action_type, "recipient": recipient, "user_id": user_id,
        "title": title, "body": body,
    }


def _normalize_send_template(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    template_id = int(raw.get("template_id") or 0)
    if not template_id:
        raise InvalidAutomation(f"Acción {position}: selecciona una plantilla")
    refs.templates.add(template_id)
    return {"type": action_type, "template_id": template_id}


def _normalize_send_message(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    text = str(raw.get("text") or "").strip()
    if not text:
        raise InvalidAutomation(f"Acción {position}: escribe el mensaje a enviar")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise InvalidAutomation(f"Acción {position}: el mensaje admite máximo {MAX_WHATSAPP_TEXT_LENGTH} caracteres")
    return {"type": action_type, "text": text}


def _normalize_reaction(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    emoji = str(raw.get("emoji") or "").strip()
    if not emoji or len(emoji) > MAX_REACTION_LENGTH:
        raise InvalidAutomation(f"Acción {position}: selecciona una reacción válida")
    return {"type": action_type, "emoji": emoji}


def _normalize_change_service(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    # Vacío es válido — significa quitar el servicio de interés actual, no un
    # error de formulario.
    service = str(raw.get("service") or "").strip()[:160] or None
    return {"type": action_type, "service": service}


def _normalize_conversation_state(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    state = str(raw.get("state") or "")
    if state not in CONVERSATION_STATES:
        raise InvalidAutomation(f"Acción {position}: estado de conversación inválido")
    return {"type": action_type, "state": state}


def _normalize_media_asset_action(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    media_asset_id = int(raw.get("media_asset_id") or 0)
    if not media_asset_id:
        raise InvalidAutomation(f"Acción {position}: selecciona un archivo de la librería de medios")
    refs.media_assets.add(media_asset_id)
    return {"type": action_type, "media_asset_id": media_asset_id}


def _normalize_send_media(action_type: str, raw: dict, position: int, refs: ActionReferences) -> dict:
    normalized = _normalize_media_asset_action(action_type, raw, position, refs)
    caption = str(raw.get("caption") or "").strip()
    if len(caption) > MAX_MEDIA_CAPTION_LENGTH:
        raise InvalidAutomation(
            f"Acción {position}: el caption admite máximo "
            f"{MAX_MEDIA_CAPTION_LENGTH} caracteres"
        )
    return {**normalized, "caption": caption}


ACTION_NORMALIZERS: dict[str, Callable[[str, dict, int, ActionReferences], dict]] = {
    AutomationActionType.CREATE_TASK: _normalize_create_task,
    AutomationActionType.ASSIGN_SELLER: _normalize_assign_seller,
    AutomationActionType.ADD_TAG: _normalize_tag_action,
    AutomationActionType.REMOVE_TAG: _normalize_tag_action,
    AutomationActionType.CHANGE_STAGE: _normalize_change_stage,
    AutomationActionType.NOTIFY: _normalize_notify,
    AutomationActionType.SEND_TEMPLATE: _normalize_send_template,
    AutomationActionType.SEND_MESSAGE: _normalize_send_message,
    AutomationActionType.REACT_TO_LAST_CUSTOMER_MESSAGE: _normalize_reaction,
    AutomationActionType.CHANGE_SERVICE: _normalize_change_service,
    AutomationActionType.SET_CONVERSATION_STATE: _normalize_conversation_state,
    AutomationActionType.SEND_AUDIO: _normalize_media_asset_action,
    AutomationActionType.SEND_ATTACHMENT: _normalize_media_asset_action,
    AutomationActionType.SEND_MEDIA: _normalize_send_media,
}


def normalize_trigger(trigger_type: object, trigger_config: object) -> tuple[str, dict]:
    if trigger_type not in TRIGGER_TYPES:
        raise InvalidAutomation("Disparador no soportado")
    config = trigger_config if isinstance(trigger_config, dict) else {}
    if trigger_type in OVERDUE_TRIGGERS:
        minutes = int(config.get("minutes") or 0)
        if not 1 <= minutes <= 43200:
            raise InvalidAutomation("La demora debe estar entre 1 minuto y 30 días")
        return trigger_type, {"minutes": minutes}
    return trigger_type, {}


def normalize_actions(actions: object, refs: ActionReferences, *, max_actions: int = MAX_ACTIONS) -> list[dict]:
    actions = actions if isinstance(actions, list) else []
    if not 1 <= len(actions) <= max_actions:
        raise InvalidAutomation(f"Configura entre 1 y {max_actions} acciones")
    normalized_actions: list[dict] = []
    for position, raw in enumerate(actions, start=1):
        if not isinstance(raw, dict) or raw.get("type") not in ACTION_NORMALIZERS:
            raise InvalidAutomation(f"Acción {position}: tipo no soportado")
        action_type = raw["type"]
        normalized_actions.append(
            ACTION_NORMALIZERS[action_type](action_type, raw, position, refs)
        )

    for position, action in enumerate(normalized_actions, start=1):
        unknown = set().union(*(
            unknown_variables(value)
            for value in action.values()
            if isinstance(value, str)
        ))
        if unknown:
            names = ", ".join(f"{{{{{name}}}}}" for name in sorted(unknown))
            raise InvalidAutomation(f"Acción {position}: variables no reconocidas: {names}")
    return normalized_actions


@rejects_malformed_input
def normalize_rule(values: dict, *, max_actions: int = MAX_ACTIONS) -> tuple[dict, ActionReferences]:
    """La regla en su forma guardable y los ids que falta verificar contra la
    base. El tope por hora se valida después de esa verificación, en
    ``normalize_rate_limit``, para conservar el orden de los mensajes."""
    name = str(values.get("name") or "").strip()
    if not name or len(name) > 120:
        raise InvalidAutomation("El nombre debe tener entre 1 y 120 caracteres")
    trigger_type, trigger_config = normalize_trigger(values.get("trigger_type"), values.get("trigger_config"))
    conditions = normalize_conditions(values.get("conditions"))
    refs = ActionReferences()
    actions = normalize_actions(values.get("actions"), refs, max_actions=max_actions)
    if conditions["seller_id"]:
        refs.users.add(conditions["seller_id"])
    if conditions["tag_id"]:
        refs.tags.add(conditions["tag_id"])
    if conditions["stage"]:
        refs.condition_stages.add(conditions["stage"])
    return {
        "name": name,
        "trigger_type": trigger_type,
        "trigger_config": trigger_config,
        "conditions": conditions,
        "actions": actions,
        "delay_minutes": int(values.get("delay_minutes") or 0),
        "is_active": bool(values.get("is_active", True)),
        "visible_to_sellers": bool(values.get("visible_to_sellers", False)),
    }, refs


@rejects_malformed_input
def normalize_rate_limit(value: object) -> int | None:
    if value is not None and not 1 <= int(value) <= 1000:
        raise InvalidAutomation("El límite por hora debe estar entre 1 y 1000")
    return int(value) if value else None


def normalize_wait_any_conditions(data: dict, position: int) -> dict:
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
        raise InvalidAutomation(f"Pausa {position}: configura al menos una condición")
    kinds_seen: set[str] = set()
    conditions: list[dict] = []
    for raw in raw_conditions:
        kind = raw.get("kind") if isinstance(raw, dict) else None
        if kind not in set(WaitAnyConditionKind):
            raise InvalidAutomation(f"Pausa {position}: condición inválida")
        if kind in kinds_seen:
            raise InvalidAutomation(f"Pausa {position}: no repitas el mismo tipo de condición")
        kinds_seen.add(kind)
        if kind == WaitAnyConditionKind.TIMER:
            seconds = int(raw.get("seconds") or 0)
            if not 1 <= seconds <= 604800:
                raise InvalidAutomation(f"Pausa {position}: el temporizador debe estar entre 1 segundo y 7 días")
            conditions.append({"id": kind, "kind": kind, "seconds": seconds})
        else:
            conditions.append({"id": kind, "kind": kind})
    if WaitAnyConditionKind.TIMER not in kinds_seen:
        raise InvalidAutomation(
            f"Pausa {position}: agrega un temporizador — es obligatorio, para que la "
            "ejecución nunca quede esperando para siempre"
        )
    return {"conditions": conditions}


MAX_QUESTION_BUTTONS = limit("max_buttons")


def _question_button_label(raw_button: object) -> str:
    """Un botón llega como string simple o como `{id, label}` — el editor
    visual siempre manda esto último para poder asignarle un id estable al
    handle del grafo."""
    if isinstance(raw_button, dict):
        return str(raw_button.get("label") or "").strip()[:limit("button_title")]
    if isinstance(raw_button, str):
        return raw_button.strip()[:limit("button_title")]
    return ""


def normalize_question(data: dict, position: int) -> dict:
    """Bloque Pregunta (`question`): manda un mensaje con hasta 3 botones y
    ramifica según cuál tocó el cliente. `id` de cada botón es `btn_1..btn_n`
    (mismo esquema que ya usaba la acción `send_buttons` que este nodo
    reemplaza) — son, junto con `other` (otra respuesta) y `timeout` (no
    contestó a tiempo), los handles de salida del nodo."""
    text = str(data.get("text") or "").strip()
    if not text:
        raise InvalidAutomation(f"Pregunta {position}: escribe el mensaje")
    # Va como cuerpo de un interactivo de botones de Meta.
    if len(text) > limit("body"):
        raise InvalidAutomation(f"Pregunta {position}: el mensaje admite máximo {limit('body')} caracteres")
    raw_buttons = data.get("buttons")
    labels = [
        label for label in (
            _question_button_label(raw_button)
            for raw_button in (raw_buttons if isinstance(raw_buttons, list) else [])
        )
        if label
    ]
    if not 1 <= len(labels) <= MAX_QUESTION_BUTTONS:
        raise InvalidAutomation(f"Pregunta {position}: configura entre 1 y {MAX_QUESTION_BUTTONS} botones")
    timeout_seconds = int(data.get("timeout_seconds") or 0)
    if not 1 <= timeout_seconds <= 604800:
        raise InvalidAutomation(f"Pregunta {position}: el tiempo de espera debe estar entre 1 segundo y 7 días")
    buttons = [{"id": f"btn_{index}", "label": label} for index, label in enumerate(labels, start=1)]
    return {"text": text, "buttons": buttons, "timeout_seconds": timeout_seconds}


MAX_ROUND_ROBIN_OUTPUTS = 10


def normalize_round_robin(data: dict, position: int) -> dict:
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
        raise InvalidAutomation(
            f"Round robin {position}: configura entre 2 y {MAX_ROUND_ROBIN_OUTPUTS} salidas"
        )
    return {
        "outputs": [
            {"id": f"out_{index}", "label": label or f"Salida {index}"}
            for index, label in enumerate(labels, start=1)
        ],
    }


def normalize_flow_condition(data: dict, position: int) -> tuple[dict, int | None, int | None]:
    condition_type = str(data.get("condition_type") or "")
    if condition_type not in FLOW_CONDITION_TYPES:
        raise InvalidAutomation(f"Condición {position}: tipo no soportado")
    value = data.get("value")
    user_id = None
    tag_id = None
    if condition_type == FlowConditionType.STAGE_EQUALS:
        value = str(value or "")
        # La existencia en el negocio la verifica flow_validation con el
        # resto de las referencias del flujo.
        if not is_stage_key(value):
            raise InvalidAutomation(f"Condición {position}: etapa inválida")
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
            raise InvalidAutomation(f"Condición {position}: escribe un valor de hasta {max_length} caracteres")
    elif condition_type in {FlowConditionType.REPLY_ID_EQUALS, FlowConditionType.MESSAGE_TYPE_EQUALS}:
        value = str(value or "").strip()
        if not value or len(value) > limit("button_id"):
            raise InvalidAutomation(f"Condición {position}: escribe un valor de hasta {limit('button_id')} caracteres")
    elif condition_type == FlowConditionType.SELLER_EQUALS:
        user_id = int(value or 0)
        if not user_id:
            raise InvalidAutomation(f"Condición {position}: selecciona un vendedor")
        value = user_id
    elif condition_type == FlowConditionType.TAG_PRESENT:
        tag_id = int(value or 0)
        if not tag_id:
            raise InvalidAutomation(f"Condición {position}: selecciona una etiqueta")
        value = tag_id
    else:
        value = True
    return {"condition_type": condition_type, "value": value}, user_id, tag_id


def normalize_flow_condition_node(
    data: dict, position: int,
) -> tuple[dict, set[int], set[int]]:
    """Normaliza grupos OR de condiciones AND, aceptando el formato legado.

    `condition_groups`: cualquiera de los grupos puede cumplir (OR); dentro
    de cada grupo deben cumplir todas las condiciones (AND). Un nodo viejo
    con `condition_type`/`value` se convierte en un grupo de una condición.
    """
    raw_groups = data.get("condition_groups")
    if raw_groups is None:
        normalized, user_id, tag_id = normalize_flow_condition(data, position)
        return {
            "condition_groups": [{
                "id": "group_1",
                "conditions": [{"id": "condition_1", **normalized}],
            }],
        }, ({user_id} if user_id else set()), ({tag_id} if tag_id else set())
    if not isinstance(raw_groups, list) or not 1 <= len(raw_groups) <= MAX_CONDITION_GROUPS:
        raise InvalidAutomation(
            f"Condición {position}: configura entre 1 y {MAX_CONDITION_GROUPS} grupos"
        )

    groups: list[dict] = []
    users: set[int] = set()
    tags: set[int] = set()
    group_ids: set[str] = set()
    total_conditions = 0
    for group_position, raw_group in enumerate(raw_groups, start=1):
        if not isinstance(raw_group, dict):
            raise InvalidAutomation(f"Condición {position}, grupo {group_position}: formato inválido")
        group_id = str(raw_group.get("id") or f"group_{group_position}").strip()[:80]
        if not group_id or group_id in group_ids:
            raise InvalidAutomation(f"Condición {position}: identificador de grupo vacío o duplicado")
        group_ids.add(group_id)
        raw_conditions = raw_group.get("conditions")
        if not isinstance(raw_conditions, list) or not 1 <= len(raw_conditions) <= MAX_CONDITIONS_PER_GROUP:
            raise InvalidAutomation(
                f"Condición {position}, grupo {group_position}: configura entre 1 y "
                f"{MAX_CONDITIONS_PER_GROUP} reglas AND"
            )
        condition_ids: set[str] = set()
        conditions: list[dict] = []
        for condition_position, raw_condition in enumerate(raw_conditions, start=1):
            if not isinstance(raw_condition, dict):
                raise InvalidAutomation(
                    f"Condición {position}, grupo {group_position}, regla {condition_position}: formato inválido"
                )
            condition_id = str(
                raw_condition.get("id") or f"condition_{condition_position}"
            ).strip()[:80]
            if not condition_id or condition_id in condition_ids:
                raise InvalidAutomation(
                    f"Condición {position}, grupo {group_position}: identificador de regla vacío o duplicado"
                )
            condition_ids.add(condition_id)
            normalized, user_id, tag_id = normalize_flow_condition(raw_condition, position)
            conditions.append({"id": condition_id, **normalized})
            if user_id:
                users.add(user_id)
            if tag_id:
                tags.add(tag_id)
        total_conditions += len(conditions)
        groups.append({"id": group_id, "conditions": conditions})
    if total_conditions > MAX_CONDITIONS_PER_NODE:
        raise InvalidAutomation(
            f"Condición {position}: admite hasta {MAX_CONDITIONS_PER_NODE} reglas en total"
        )
    return {"condition_groups": groups}, users, tags
