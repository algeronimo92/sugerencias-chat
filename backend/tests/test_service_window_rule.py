"""La ventana de atención de 24 h es una sola regla para los tres caminos.

Estaba implementada tres veces: las automatizaciones la consultaban bien, los
mensajes programados reimplementaban la query a mano, y el envío manual del
vendedor no la comprobaba — el mensaje salía, Meta lo rechazaba, y al vendedor
le quedaba un "no enviado" con un botón de reintento inservible.
"""

import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import chats
from models.schemas import SendMessageRequest
from services.service_window import SERVICE_WINDOW_CLOSED_DETAIL, window_is_open
from tests.conftest import open_service_window, patch_chats

BACKEND = Path(__file__).resolve().parent.parent
SELLER = SimpleNamespace(id=7, role="vendedor")
CHAT_ID = "51999999999@s.whatsapp.net"


@pytest.mark.parametrize(("window", "esperado"), [
    ({"is_open": True, "seconds_remaining": 3600}, True),
    ({"is_open": False, "seconds_remaining": 0}, False),
    (None, False),
])
def test_the_decision_is_the_same_wherever_the_window_comes_from(window, esperado):
    """Las automatizaciones reciben la ventana inyectada y los otros dos la
    consultan; la decisión tiene que ser la misma función."""
    assert window_is_open(window) is esperado


async def test_a_manual_send_with_the_window_closed_is_refused_before_queueing(monkeypatch):
    patch_chats(monkeypatch, "_require_existing_lead", AsyncMock())
    open_service_window(monkeypatch, is_open=False)
    enqueue = AsyncMock()
    patch_chats(monkeypatch, "enqueue_text_message", enqueue)

    with pytest.raises(HTTPException) as exc:
        await chats.send_message(CHAT_ID, SendMessageRequest(text="Hola"), SELLER)

    assert exc.value.status_code == 409
    assert exc.value.detail == SERVICE_WINDOW_CLOSED_DETAIL
    enqueue.assert_not_awaited()


def test_nobody_reimplements_the_window_on_their_own():
    """`CUSTOMER_SERVICE_WINDOW` es el plazo crudo: fuera de la capa de datos
    que lo calcula y del módulo de la regla, usarlo significa estar
    reimplementando la decisión."""
    permitidos = {
        "services/store/common.py",
        "services/store/chat_queries.py",
        "services/db_service.py",
        "services/service_window.py",
    }
    culpables = set()
    for path in [*(BACKEND / "services").rglob("*.py"), *(BACKEND / "routers").rglob("*.py")]:
        if str(path.relative_to(BACKEND)) in permitidos:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Name) and node.id == "CUSTOMER_SERVICE_WINDOW":
                culpables.add(str(path.relative_to(BACKEND)))

    assert culpables == set()
