"""Cómo se descubren las respuestas a un bloque Pausa/Pregunta.

Antes la query traía todas las ejecuciones en espera y preguntaba por cada una
si el cliente ya había contestado: una consulta por ejecución. Eso obligaba a
correrla solo una vez por minuto (el bot tardaba hasta 60 s en reaccionar a un
botón) y a cortar con `limit(200)` sin orden, así que con más de 200 esperando
las del fondo no se miraban nunca y salían por la rama del timeout como si el
cliente no hubiera escrito.
"""

import ast
from pathlib import Path

from services.automations import discovery

FUENTE = Path(discovery.__file__)


def _funcion(nombre: str) -> ast.AST:
    tree = ast.parse(FUENTE.read_text(encoding="utf-8"))
    return next(
        node for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == nombre
    )


def _llamadas(node: ast.AST) -> set[str]:
    return {
        sub.func.id
        for sub in ast.walk(node)
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name)
    }


def test_the_query_only_asks_for_executions_that_have_something_to_resume():
    """El EXISTS es lo que hace barato correrla seguido y lo que saca el
    hambre del limit: sin él vuelven todas las que esperan."""
    cuerpo = ast.unparse(_funcion("_discover_wait_any_replies"))

    assert "exists(" in cuerpo
    assert "waiting_since" in cuerpo
    assert "watching_message_id" in cuerpo


def test_the_cut_is_deterministic():
    """Un `limit` sin `order_by` deja que Postgres elija: las mismas filas
    quedan afuera en cada barrido."""
    cuerpo = ast.unparse(_funcion("_discover_wait_any_replies"))

    assert ".order_by(" in cuerpo
    assert ".limit(200)" in cuerpo


def test_replies_are_discovered_on_every_loop_and_not_once_a_minute():
    """`_wake` despierta el bucle cuando entra un mensaje; si el descubrimiento
    vive dentro del bloque de housekeeping, ese despertar no sirve de nada."""
    bucle = _funcion("watch_automations")
    housekeeping = next(
        node for node in ast.walk(bucle)
        if isinstance(node, ast.If) and "next_housekeeping_at" in ast.unparse(node.test)
    )

    assert "_discover_wait_any_replies" not in _llamadas(housekeeping)
    assert "_discover_wait_any_replies" in _llamadas(bucle)


def test_the_expensive_sweeps_stay_in_the_housekeeping_block():
    """Lo que sí recorre tablas enteras se queda en el minuto."""
    housekeeping = next(
        node for node in ast.walk(_funcion("watch_automations"))
        if isinstance(node, ast.If) and "next_housekeeping_at" in ast.unparse(node.test)
    )
    llamadas = _llamadas(housekeeping)

    assert {
        "_release_stale_executions",
        "_discover_recent_inbound_messages",
        "_discover_timed_events",
        "_auto_close_idle_conversations",
    } <= llamadas
