"""Forma del grafo de un flujo visual: conexiones válidas, topología
ejecutable e índices para recorrerlo."""

from domain_types import FlowHandle, FlowNodeType, QuestionHandle, WaitAnyConditionKind


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
            required = {button["id"] for button in node["data"].get("buttons", [])} | {
                QuestionHandle.OTHER, QuestionHandle.TIMEOUT,
            }
            # "Mandó la foto" es la única salida opcional: sin conectar, esas
            # respuestas caen en "otra respuesta" como antes de que la salida
            # existiera — así los flujos ya publicados se siguen validando.
            allowed = required | {QuestionHandle.MEDIA}
            handles = [edge["source_handle"] for edge in node_edges]
            if len(handles) != len(set(handles)) or not set(handles) <= allowed or not required <= set(handles):
                raise ValueError("Cada botón, \"otra respuesta\" y \"sin respuesta\" deben tener su propia salida")
        elif node["type"] == FlowNodeType.ROUND_ROBIN:
            expected = {output["id"] for output in node["data"].get("outputs", [])}
            handles = [edge["source_handle"] for edge in node_edges]
            # Todas obligatorias: el reparto por turnos le toca a cada salida
            # tarde o temprano, y una sin conectar dejaría al lead sin camino.
            if len(handles) != len(expected) or set(handles) != expected:
                raise ValueError("Cada salida del round robin debe estar conectada")
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
