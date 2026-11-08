"""Forma del grafo de un flujo visual: conexiones válidas, topología
ejecutable e índices para recorrerlo."""

from app.modules.automations.domain.types import FlowHandle, FlowNodeType, QuestionHandle, WaitAnyConditionKind
from app.modules.automations.domain.errors import InvalidAutomation


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
    for raw_edge in raw_edges:
        if not isinstance(raw_edge, dict):
            raise InvalidAutomation("Una conexión no se pudo leer. Si importaste un JSON, revísalo.")
        source = str(raw_edge.get("source") or "")
        target = str(raw_edge.get("target") or "")
        handle = str(raw_edge.get("source_handle") or FlowHandle.NEXT)
        edge_id = str(raw_edge.get("id") or f"{source}:{handle}:{target}")[:160]
        if source not in node_ids or target not in node_ids or source == target:
            raise InvalidAutomation("Una conexión une un bloque consigo mismo o con uno que ya no existe. Si importaste un JSON, revísalo.")
        if handle not in valid_handles and not allow_duplicate_handles:
            raise InvalidAutomation("Una conexión sale por una salida que el bloque ya no tiene. Vuelve a conectarla.", node_id=source)
        if edge_id in edge_ids:
            raise InvalidAutomation("Hay dos conexiones con el mismo identificador. Si importaste un JSON, revísalo.")
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
                raise InvalidAutomation("Un bloque Fin termina el flujo: quita la conexión que sale de él.", node_id=node["id"])
        elif node["type"] == FlowNodeType.CONDITION:
            handles = sorted(edge["source_handle"] for edge in node_edges)
            groups = node["data"].get("condition_groups")
            expected = (
                {group["id"] for group in groups} | {FlowHandle.NO}
                if isinstance(groups, list)
                else {FlowHandle.YES, FlowHandle.NO}
            )
            if len(handles) != len(expected) or set(handles) != expected:
                raise InvalidAutomation(
                    "Conecta todas sus salidas: cada grupo de condiciones y también «Ninguna de las condiciones»."
                    if isinstance(groups, list)
                    else "Conecta sus dos salidas: «Sí» y «No».",
                    node_id=node["id"],
                )
        elif node["type"] == FlowNodeType.WAIT_ANY:
            expected = {condition["id"] for condition in node["data"].get("conditions", [])}
            handles = [edge["source_handle"] for edge in node_edges]
            # El temporizador es la única salida opcional: si no se conecta,
            # el flujo simplemente termina ahí al cumplirse (ver
            # _run_visual_execution). Las demás condiciones sí son obligatorias.
            required = expected - {WaitAnyConditionKind.TIMER}
            if len(handles) != len(set(handles)) or not set(handles) <= expected or not required <= set(handles):
                raise InvalidAutomation("Conecta la salida de cada condición de la pausa. Solo la del temporizador puede quedar sin conectar: ahí termina el flujo.", node_id=node["id"])
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
                raise InvalidAutomation("Conecta la salida de cada botón, de «Otra respuesta» y de «Sin respuesta».", node_id=node["id"])
        elif node["type"] == FlowNodeType.ROUND_ROBIN:
            expected = {output["id"] for output in node["data"].get("outputs", [])}
            handles = [edge["source_handle"] for edge in node_edges]
            # Todas obligatorias: el reparto por turnos le toca a cada salida
            # tarde o temprano, y una sin conectar dejaría al lead sin camino.
            if len(handles) != len(expected) or set(handles) != expected:
                raise InvalidAutomation("Conecta todas sus salidas: a cualquiera le puede tocar el próximo lead.", node_id=node["id"])
        elif len(node_edges) != 1 or node_edges[0]["source_handle"] != FlowHandle.NEXT:
            raise InvalidAutomation("Falta conectar su salida: únela al bloque que sigue o a un Fin.", node_id=node["id"])
        if node["id"] != trigger_id and not incoming[node["id"]]:
            raise InvalidAutomation("Ningún bloque conecta con este. Conéctalo desde el bloque anterior o bórralo.", node_id=node["id"])

    visiting: set[str] = set()
    visited: set[str] = set()

    def walk(node_id: str) -> None:
        if node_id in visiting:
            raise InvalidAutomation("Un bloque posterior vuelve a conectar con este y el flujo se repetiría sin fin. Revisa «Llega desde» y quita la conexión que regresa.", node_id=node_id)
        if node_id in visited:
            return
        visiting.add(node_id)
        for edge in outgoing[node_id]:
            walk(edge["target"])
        visiting.remove(node_id)
        visited.add(node_id)

    walk(trigger_id)
    if visited != node_ids:
        unreachable = next(node["id"] for node in nodes if node["id"] not in visited)
        raise InvalidAutomation("Ninguna ruta desde el inicio del flujo llega a este bloque. Conéctalo desde un bloque que sí tenga ruta, o bórralo.", node_id=unreachable)


def flow_indexes(definition: dict) -> tuple[dict[str, dict], dict[tuple[str, str], str]]:
    nodes = {node["id"]: node for node in definition.get("nodes", [])}
    edges = {
        (edge["source"], edge.get("source_handle") or FlowHandle.NEXT): edge["target"]
        for edge in definition.get("edges", [])
    }
    return nodes, edges
