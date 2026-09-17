"""Ordenar mensajes por `sent_at` sin desempatar es ambiguo.

Los `sent_at` de lo que entra vienen del timestamp de WhatsApp, que tiene
resolución de **segundo**: dos mensajes del cliente escritos rápido, o un
álbum, comparten valor. Un `ORDER BY sent_at DESC LIMIT 1` sobre ellos devuelve
cualquiera de los dos según el plan.

Donde más duele es en la lista de chats: `last_message_sender` decide si el
chat se ve como "esperando respuesta", así que el chat de un cliente que acaba
de escribir puede dejar de aparecer como pendiente.
"""

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent


def _order_by_calls(path: Path):
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "order_by"
        ):
            yield node


def _sorts_by_sent_at_first(call: ast.Call) -> bool:
    if not call.args:
        return False
    return "sent_at" in ast.unparse(call.args[0])


def _has_id_tiebreaker(call: ast.Call) -> bool:
    return any("id" in ast.unparse(arg) for arg in call.args[1:])


# `fetch_chats` y el kanban ordenan la lista de leads por la fecha del último
# mensaje y desempatan por `Lead.id`, no por el id del mensaje: son filas de
# leads, no de mensajes.
EXCEPCIONES = {"last_message.c.sent_at"}


@pytest.mark.parametrize("modulo", sorted(
    str(path.relative_to(BACKEND))
    for base in ("services", "routers")
    for path in (BACKEND / base).rglob("*.py")
))
def test_sorting_messages_by_date_always_breaks_the_tie_by_id(modulo):
    sin_desempate = [
        ast.unparse(call.args[0])
        for call in _order_by_calls(BACKEND / modulo)
        if _sorts_by_sent_at_first(call)
        and not _has_id_tiebreaker(call)
        and ast.unparse(call.args[0]).split(".desc")[0] not in EXCEPCIONES
    ]

    assert sin_desempate == []
