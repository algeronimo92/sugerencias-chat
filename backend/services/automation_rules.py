"""Lógica del motor de automatizaciones que no toca base de datos, red ni reloj.

Está separada de automation_service para poder testear las reglas —
sustitución de variables, normalización de condiciones y validación del grafo
del flujo visual— sin levantar PostgreSQL ni Evolution API.

Todo lo que necesite I/O (ventana de WhatsApp, existencia de un vendedor,
envío de mensajes) vive en automation_service y recibe sus colaboradores por
AutomationDeps.
"""

import re
from datetime import datetime, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo

from domain_types import FlowHandle, FlowNodeType, QuestionHandle, WaitAnyConditionKind
from db.models import LeadStage

BUSINESS_TIMEZONE_KEY = "America/Lima"
BUSINESS_START_HOUR = 8
BUSINESS_END_HOUR = 18
CRM_VARIABLES = {"nombre", "telefono", "servicio", "vendedor", "fecha_actual"}
MAX_COOLDOWN_MINUTES = 43200

_VARIABLE_PATTERN = re.compile(r"\{\{(\w+)\}\}")


@lru_cache(maxsize=1)
def business_timezone() -> tzinfo:
    """Se resuelve al primer uso y no al importar: en Windows sin el paquete
    tzdata, hacerlo a nivel de módulo revienta el arranque entero."""
    return ZoneInfo(BUSINESS_TIMEZONE_KEY)


def render_variables(value: str, chat: dict, now: datetime | None = None) -> str:
    """Reemplaza {{variable}} por los datos del lead. Las variables
    desconocidas se dejan intactas para que el texto no pierda información."""
    local_now = now or datetime.now(business_timezone())
    values = {
        "nombre": chat.get("name") or "",
        "telefono": chat.get("phone") or "",
        "servicio": chat.get("servicio_interes") or "",
        "vendedor": chat.get("vendedor") or "",
        "fecha_actual": local_now.strftime("%d/%m/%Y"),
    }
    return _VARIABLE_PATTERN.sub(lambda match: values.get(match.group(1), match.group(0)), value)


def unknown_variables(value: str) -> set[str]:
    return set(_VARIABLE_PATTERN.findall(value)) - CRM_VARIABLES


def is_business_hours(now: datetime) -> bool:
    return now.weekday() < 5 and BUSINESS_START_HOUR <= now.hour < BUSINESS_END_HOUR


def normalize_conditions(raw_conditions: object) -> dict:
    conditions = raw_conditions if isinstance(raw_conditions, dict) else {}
    normalized = {
        "stage": str(conditions.get("stage") or "").strip() or None,
        "origin_contains": str(conditions.get("origin_contains") or "").strip()[:120] or None,
        "service_contains": str(conditions.get("service_contains") or "").strip()[:120] or None,
        "seller_id": int(conditions["seller_id"]) if conditions.get("seller_id") else None,
        "tag_id": int(conditions["tag_id"]) if conditions.get("tag_id") else None,
        "require_open_window": bool(conditions.get("require_open_window", False)),
        "business_hours_only": bool(conditions.get("business_hours_only", False)),
        "cooldown_minutes": (
            max(1, min(MAX_COOLDOWN_MINUTES, int(conditions["cooldown_minutes"])))
            if conditions.get("cooldown_minutes")
            else None
        ),
    }
    if normalized["stage"] and normalized["stage"] not in {stage.value for stage in LeadStage}:
        raise ValueError("Etapa de condición inválida")
    return normalized


def matches_static_conditions(conditions: dict, chat: dict) -> tuple[bool, str | None]:
    """Condiciones que se resuelven solo con los datos del lead ya cargados.
    Las que requieren consultar la base (cooldown, ventana de WhatsApp) las
    evalúa automation_service antes de delegar acá."""
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
    return True, None


FLOW_COORDINATE_LIMIT = 1_000_000


def _normalize_flow_coordinate(value: object) -> int:
    try:
        coordinate = int(value or 0)
    except (TypeError, ValueError, OverflowError):
        coordinate = 0
    return max(-FLOW_COORDINATE_LIMIT, min(FLOW_COORDINATE_LIMIT, coordinate))


def normalize_flow_position(value: object) -> dict:
    """Conserva la posición del lienzo en un rango prácticamente infinito.

    El límite evita valores no representables o coordenadas absurdas que
    degraden el navegador, pero permite más de dos millones de unidades en
    cada eje y trabajar también a la izquierda/arriba del origen.
    """
    position = value if isinstance(value, dict) else {}
    return {
        "x": _normalize_flow_coordinate(position.get("x")),
        "y": _normalize_flow_coordinate(position.get("y")),
    }


def normalize_edges(
    raw_edges: list, node_ids: set[str], allow_duplicate_handles: bool = True,
    extra_handles: set[str] | None = None,
) -> list[dict]:
    """Valida forma y referencias de las conexiones. No mira la topología:
    de eso se encarga validate_graph_topology.

    `extra_handles` admite handles dinámicos de grupos Condición, bloques
    Pausa y Pregunta, que no forman parte del enum fijo FlowHandle.
    """
    valid_handles = set(FlowHandle) | (extra_handles or set())
    edges: list[dict] = []
    edge_ids: set[str] = set()
    for position, raw_edge in enumerate(raw_edges, start=1):
        if not isinstance(raw_edge, dict):
            raise ValueError(f"Conexión {position}: formato inválido")
        source = str(raw_edge.get("source") or "")
        target = str(raw_edge.get("target") or "")
        handle = str(raw_edge.get("source_handle") or FlowHandle.NEXT)
        edge_id = str(raw_edge.get("id") or f"{source}:{handle}:{target}")[:160]
        if source not in node_ids or target not in node_ids or source == target:
            raise ValueError(f"Conexión {position}: origen o destino inválido")
        if handle not in valid_handles and not allow_duplicate_handles:
            raise ValueError(f"Conexión {position}: salida o identificador inválido")
        if edge_id in edge_ids:
            raise ValueError(f"Conexión {position}: identificador duplicado")
        edge_ids.add(edge_id)
        edges.append({"id": edge_id, "source": source, "target": target, "source_handle": handle})
    return edges


def validate_graph_topology(nodes: list[dict], edges: list[dict], trigger_id: str) -> None:
    """Comprueba que el flujo sea ejecutable: salidas correctas por tipo de
    bloque, todo alcanzable desde el disparador y sin ciclos.

    Un ciclo haría que el motor recorriera bloques para siempre, y un bloque
    inalcanzable es casi siempre un error de armado que el usuario no ve.
    """
    node_ids = {node["id"] for node in nodes}
    outgoing: dict[str, list[dict]] = {node_id: [] for node_id in node_ids}
    incoming: dict[str, int] = {node_id: 0 for node_id in node_ids}
    for edge in edges:
        outgoing[edge["source"]].append(edge)
        incoming[edge["target"]] += 1

    for node in nodes:
        node_edges = outgoing[node["id"]]
        if node["type"] == FlowNodeType.END:
            if node_edges:
                raise ValueError("Un bloque Fin no puede tener conexiones de salida")
        elif node["type"] == FlowNodeType.CONDITION:
            handles = sorted(edge["source_handle"] for edge in node_edges)
            groups = node["data"].get("condition_groups")
            expected = (
                {group["id"] for group in groups} | {FlowHandle.NO}
                if isinstance(groups, list)
                else {FlowHandle.YES, FlowHandle.NO}
            )
            if len(handles) != len(expected) or set(handles) != expected:
                raise ValueError(
                    "Cada grupo OR y la opción Ninguna deben tener su propia salida"
                    if isinstance(groups, list)
                    else "Cada condición debe tener exactamente una salida Sí y una salida No"
                )
        elif node["type"] == FlowNodeType.WAIT_ANY:
            expected = {condition["id"] for condition in node["data"].get("conditions", [])}
            handles = [edge["source_handle"] for edge in node_edges]
            # El temporizador es la única salida opcional: si no se conecta,
            # el flujo simplemente termina ahí al cumplirse (ver
            # _run_visual_execution). Las demás condiciones sí son obligatorias.
            required = expected - {WaitAnyConditionKind.TIMER}
            if len(handles) != len(set(handles)) or not set(handles) <= expected or not required <= set(handles):
                raise ValueError("Cada condición de la pausa debe tener su propia salida (el temporizador es opcional)")
        elif node["type"] == FlowNodeType.QUESTION:
            expected = {button["id"] for button in node["data"].get("buttons", [])} | {
                QuestionHandle.OTHER, QuestionHandle.TIMEOUT,
            }
            handles = [edge["source_handle"] for edge in node_edges]
            if len(handles) != len(expected) or set(handles) != expected:
                raise ValueError("Cada botón, \"otra respuesta\" y \"sin respuesta\" deben tener su propia salida")
        elif len(node_edges) != 1 or node_edges[0]["source_handle"] != FlowHandle.NEXT:
            raise ValueError("Cada disparador, acción, invocación o espera debe tener exactamente una salida")
        if node["id"] != trigger_id and not incoming[node["id"]]:
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
    if visited != node_ids:
        raise ValueError("Hay bloques que no son alcanzables desde el disparador")


def flow_indexes(definition: dict) -> tuple[dict[str, dict], dict[tuple[str, str], str]]:
    nodes = {node["id"]: node for node in definition.get("nodes", [])}
    edges = {
        (edge["source"], edge.get("source_handle") or FlowHandle.NEXT): edge["target"]
        for edge in definition.get("edges", [])
    }
    return nodes, edges
