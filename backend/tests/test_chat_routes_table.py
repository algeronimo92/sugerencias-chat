"""El router de chats está partido en varios módulos y el orden en que se
incluyen es el orden en que FastAPI resuelve.

Importa porque hay rutas literales que comparten forma con `/{chat_id}`: si
`/sellers` se registrara después, `GET /api/chats/sellers` entraría por
`get_chat` con `chat_id="sellers"` y el listado de vendedores devolvería 404
sin que nada más se rompa. El orden también es el de `paths` en el OpenAPI, así
que moverlo regenera `schema.d.ts` entero.
"""

import pytest

from routers import chats

EXPECTED_ROUTES = [
    ("GET", "/api/chats", "get_chats"),
    ("GET", "/api/chats/unread-count", "get_unread_count"),
    ("GET", "/api/chats/kanban/counts", "get_kanban_counts"),
    ("GET", "/api/chats/kanban/snapshot", "get_kanban_snapshot"),
    ("GET", "/api/chats/kanban/{stage}", "get_kanban_stage"),
    ("PATCH", "/api/chats/{chat_id}/stage", "move_chat_stage"),
    ("POST", "/api/chats", "create_chat"),
    ("PATCH", "/api/chats/{chat_id}", "update_chat"),
    ("GET", "/api/chats/sellers", "get_sellers"),
    ("GET", "/api/chats/phone-config", "get_phone_config"),
    ("GET", "/api/chats/{chat_id}", "get_chat"),
    ("POST", "/api/chats/{chat_id}/no-show", "register_no_show"),
    ("DELETE", "/api/chats/{chat_id}", "delete_chat"),
    ("POST", "/api/chats/{chat_id}/merge", "merge_chat"),
    ("POST", "/api/chats/{chat_id}/tags/{tag_id}", "add_chat_tag"),
    ("DELETE", "/api/chats/{chat_id}/tags/{tag_id}", "delete_chat_tag"),
    ("GET", "/api/chats/{chat_id}/activity", "get_chat_activity"),
    ("GET", "/api/chats/{chat_id}/messages", "get_messages"),
    ("GET", "/api/chats/history/availability", "get_history_availability"),
    ("GET", "/api/chats/{chat_id}/history", "get_whatsapp_history"),
    ("GET", "/api/chats/{chat_id}/service-window", "get_service_window"),
    ("POST", "/api/chats/{chat_id}/messages", "send_message"),
    ("POST", "/api/chats/{chat_id}/audio", "send_audio"),
    ("POST", "/api/chats/{chat_id}/media", "send_media"),
    ("POST", "/api/chats/{chat_id}/sticker", "send_sticker"),
    ("POST", "/api/chats/{chat_id}/templates/{template_id}", "send_template"),
    ("POST", "/api/chats/{chat_id}/location", "send_location"),
    ("POST", "/api/chats/{chat_id}/contacts", "send_contacts"),
    ("POST", "/api/chats/{chat_id}/messages/forward", "forward_messages"),
    ("POST", "/api/chats/{chat_id}/messages/{message_id}/retry", "retry_message"),
    ("POST", "/api/chats/{chat_id}/messages/{message_id}/discard", "discard_message"),
    ("POST", "/api/chats/{chat_id}/messages/{message_id}/reaction", "react_to_message"),
    ("PATCH", "/api/chats/{chat_id}/messages/{message_id}", "edit_message"),
    ("DELETE", "/api/chats/{chat_id}/messages/{message_id}", "delete_message"),
    ("GET", "/api/chats/{chat_id}/pinned-messages", "get_pinned_messages"),
    ("POST", "/api/chats/{chat_id}/messages/{message_id}/pin", "pin_chat_message"),
    ("POST", "/api/chats/{chat_id}/messages/{message_id}/unpin", "unpin_chat_message"),
    ("POST", "/api/chats/{chat_id}/read", "read_chat"),
    ("POST", "/api/chats/{chat_id}/unread", "unread_chat"),
]

LITERALS_THAT_LOOK_LIKE_A_CHAT_ID = [
    "/api/chats/sellers",
    "/api/chats/phone-config",
    "/api/chats/unread-count",
]


def _routes():
    return [
        (method, route.path, route.name)
        for route in chats.router.routes
        for method in sorted(route.methods)
    ]


def test_the_route_table_is_exactly_this_one_in_this_order():
    assert _routes() == EXPECTED_ROUTES


@pytest.mark.parametrize("path", LITERALS_THAT_LOOK_LIKE_A_CHAT_ID)
def test_literal_paths_are_registered_before_the_chat_id_catch_all(path):
    """El orden solo decide entre rutas del mismo método: un PATCH
    /{chat_id} no se come un GET /sellers."""
    gets = [route for method, route, _ in _routes() if method == "GET"]

    assert gets.index(path) < gets.index("/api/chats/{chat_id}")


def test_the_facade_exposes_every_route_function():
    missing = [name for _, _, name in EXPECTED_ROUTES if not hasattr(chats, name)]

    assert missing == []
