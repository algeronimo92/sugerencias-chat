from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from services import whatsapp_history
from services.whatsapp_history import (
    _extract_records,
    _normalize_record,
    fetch_whatsapp_history,
)


def _record(wa_id: str, ts: int, *, from_me: bool = False, message: dict | None = None) -> dict:
    return {
        "key": {"remoteJid": "5491112345678@s.whatsapp.net", "fromMe": from_me, "id": wa_id},
        "messageTimestamp": ts,
        "message": message if message is not None else {"conversation": f"texto {wa_id}"},
    }


# --- _extract_records: la forma de la respuesta cambia entre versiones ---


def test_extract_records_reads_paginated_object():
    payload = {"messages": {"total": 120, "pages": 3, "currentPage": 2, "records": [{"a": 1}]}}

    assert _extract_records(payload) == ([{"a": 1}], 3, 2)


def test_extract_records_reads_bare_list():
    assert _extract_records([{"a": 1}, {"b": 2}]) == ([{"a": 1}, {"b": 2}], None, None)


def test_extract_records_reads_list_under_messages():
    assert _extract_records({"messages": [{"a": 1}]}) == ([{"a": 1}], None, None)


@pytest.mark.parametrize("payload", [None, "error", {"error": "boom"}, {"messages": 3}])
def test_extract_records_tolerates_unexpected_shapes(payload):
    assert _extract_records(payload) == ([], None, None)


# --- _normalize_record ---


def test_normalize_maps_from_me_to_vendedor():
    result = _normalize_record(_record("A1", 1_700_000_000, from_me=True))

    assert result["sender"] == "vendedor"
    assert result["wa_message_id"] == "A1"
    assert result["content"] == "texto A1"
    assert result["sent_at"] == datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)


def test_normalize_maps_incoming_to_cliente():
    assert _normalize_record(_record("A1", 1_700_000_000))["sender"] == "cliente"


def test_normalize_accepts_millisecond_and_string_timestamps():
    from_ms = _normalize_record(_record("A1", 1_700_000_000_000))
    from_str = _normalize_record(_record("A2", "1700000000"))

    assert from_ms["sent_at"] == from_str["sent_at"]


@pytest.mark.parametrize(
    "message,content,message_type,payload",
    [
        ({"conversation": "hola"}, "hola", "text", None),
        ({"extendedTextMessage": {"text": "hola citado"}}, "hola citado", "text", None),
        ({"imageMessage": {"caption": "mirá esto"}}, "mirá esto", "image", None),
        ({"imageMessage": {}}, None, "image", None),
        ({"videoMessage": {"caption": "v"}}, "v", "video", None),
        ({"ptvMessage": {"caption": "circular"}}, "circular", "ptv", None),
        ({"audioMessage": {"seconds": 3}}, None, "audio", None),
        (
            {"viewOnceMessage": {"message": {"imageMessage": {
                "caption": "Comprobante", "url": "https://privado.example/archivo",
                "mediaKey": "no-debe-persistirse",
            }}}},
            "Comprobante",
            "view_once",
            {"original_type": "viewOnceMessage", "inner_type": "image"},
        ),
        (
            {"viewOnceMessageV2": {"message": {"videoMessage": {"seconds": 5}}}},
            None,
            "view_once",
            {"original_type": "viewOnceMessageV2", "inner_type": "video"},
        ),
        (
            {"viewOnceMessageV2Extension": {"message": {"audioMessage": {"ptt": True}}}},
            None,
            "view_once",
            {"original_type": "viewOnceMessageV2Extension", "inner_type": "audio"},
        ),
        ({"documentMessage": {"fileName": "factura.pdf"}}, None, "document", {"filename": "factura.pdf"}),
        (
            {"locationMessage": {"degreesLatitude": -34.6, "degreesLongitude": -58.4}},
            None,
            "location",
            {"latitude": -34.6, "longitude": -58.4},
        ),
        ({"stickerMessage": {"url": "x"}}, None, "sticker", None),
        ({"contactMessage": {"displayName": "Ana"}}, None, "contact", {"contacts": [{"fullName": "Ana"}]}),
        (
            {"pollCreationMessage": {"name": "¿Horario?", "options": [{"optionName": "AM"}, {"optionName": "PM"}]}},
            "¿Horario?",
            "poll",
            {"values": ["AM", "PM"]},
        ),
        (
            {"pollCreationMessageV5": {"name": "¿Día?", "options": [{"optionName": "Lunes"}]}},
            "¿Día?",
            "poll",
            {"values": ["Lunes"]},
        ),
        (
            {"pollResultSnapshotMessage": {
                "name": "¿Horario?",
                "pollVotes": [{"optionName": "AM", "voters": ["uno", "dos"]}],
            }},
            "¿Horario?",
            "poll",
            {
                "original_type": "pollResultSnapshotMessage",
                "results": [{"option": "AM", "count": 2, "voters": ["uno", "dos"]}],
            },
        ),
        (
            {"listMessage": {
                "title": "Servicios",
                "description": "Elige uno",
                "sections": [{"rows": [{"rowId": "hifu", "title": "HIFU", "description": "Facial"}]}],
            }},
            "Elige uno",
            "interactive",
            {
                "original_type": "listMessage",
                "title": "Servicios",
                "body": "Elige uno",
                "options": [{"id": "hifu", "text": "HIFU", "description": "Facial"}],
            },
        ),
        (
            {"interactiveResponseMessage": {
                "nativeFlowResponseMessage": {"paramsJson": '{"id":"hifu","display_text":"HIFU"}'},
            }},
            "HIFU",
            "interactive",
            {"original_type": "interactiveResponseMessage", "selected_id": "hifu", "selected_text": "HIFU"},
        ),
        (
            {"orderMessage": {
                "orderId": "4VX5SPITUZD",
                "orderTitle": "Separación de cita",
                "message": "Pago: Realizado",
                "itemCount": {"low": 1, "high": 0},
                "status": "INQUIRY",
                "totalAmount1000": {"low": 50000, "high": 0},
                "totalCurrencyCode": "PEN",
                "token": "no-debe-persistirse",
            }},
            "Pago: Realizado",
            "order",
            {
                "original_type": "orderMessage",
                "order_id": "4VX5SPITUZD",
                "title": "Separación de cita",
                "message": "Pago: Realizado",
                "item_count": 1,
                "status": "INQUIRY",
                "total_amount_1000": 50000,
                "currency": "PEN",
            },
        ),
        (
            {"productMessage": {"body": "Mira este tratamiento", "product": {
                "productId": "prod-1", "retailerId": "hifu-12d", "title": "HIFU 12D",
                "description": "Tratamiento facial", "priceAmount1000": 150000,
                "salePriceAmount1000": 120000, "currencyCode": "PEN", "url": "https://example.com/hifu",
            }}},
            "HIFU 12D",
            "product",
            {
                "original_type": "productMessage", "product_id": "prod-1", "retailer_id": "hifu-12d",
                "title": "HIFU 12D", "description": "Tratamiento facial", "body": "Mira este tratamiento",
                "price_amount_1000": 150000, "sale_price_amount_1000": 120000,
                "currency": "PEN", "url": "https://example.com/hifu",
            },
        ),
        (
            {"requestPaymentMessage": {
                "paymentRequestId": "pay-1", "amount1000": 50000,
                "currencyCode": "PEN", "noteMessage": "Separación de cita",
            }},
            "Separación de cita",
            "payment",
            {
                "original_type": "requestPaymentMessage", "payment_kind": "requestPayment",
                "transaction_id": "pay-1", "amount_1000": 50000,
                "currency": "PEN", "note": "Separación de cita",
            },
        ),
        ({"algoNuevo": {}}, None, "unsupported", {"original_type": "algoNuevo"}),
    ],
)
def test_normalize_maps_evolution_types_to_taxonomy(message, content, message_type, payload):
    row = _normalize_record(_record("A1", 1_700_000_000, message=message))
    assert row["content"] == content
    assert row["message_type"] == message_type
    assert row["payload"] == payload


def test_normalize_unwraps_ephemeral_messages():
    message = {"ephemeralMessage": {"message": {"conversation": "efímero"}}}

    assert _normalize_record(_record("A1", 1_700_000_000, message=message))["content"] == "efímero"


def test_normalize_preserves_view_once_inside_ephemeral_without_media_secrets():
    message = {"ephemeralMessage": {"message": {"viewOnceMessageV2": {
        "message": {"imageMessage": {
            "caption": "Solo una vez", "directPath": "/privado", "mediaKey": "secreto",
        }},
    }}}}

    row = _normalize_record(_record("A1", 1_700_000_000, message=message))

    assert row["message_type"] == "view_once"
    assert row["content"] == "Solo una vez"
    assert row["payload"] == {"original_type": "viewOnceMessageV2", "inner_type": "image"}


@pytest.mark.parametrize(
    "message",
    [{"reactionMessage": {"text": "👍"}}, {"protocolMessage": {"type": "REVOKE"}}, {}],
)
def test_normalize_skips_messages_without_representation(message):
    assert _normalize_record(_record("A1", 1_700_000_000, message=message)) is None


@pytest.mark.parametrize(
    "record",
    [
        {"messageTimestamp": 1_700_000_000, "message": {"conversation": "x"}},  # sin key
        {"key": {"fromMe": False}, "messageTimestamp": 1_700_000_000},  # sin id
        {"key": {"id": "A1"}, "messageTimestamp": 1_700_000_000},  # sin fromMe
        {"key": {"id": "A1", "fromMe": False}, "message": {"conversation": "x"}},  # sin fecha
    ],
)
def test_normalize_descarta_registros_incompletos(record):
    assert _normalize_record(record) is None


# --- fetch_whatsapp_history ---


@pytest.fixture
def evolution(monkeypatch):
    """Reemplaza Evolution y la base por dobles controlados."""
    monkeypatch.setattr(whatsapp_history, "count_wa_messages", AsyncMock(return_value=0))
    monkeypatch.setattr(whatsapp_history, "existing_wa_message_ids", AsyncMock(return_value=set()))

    pages: dict[int, object] = {}
    calls: list[int] = []

    async def fake_find(chat_id, page, limit=50):
        calls.append(page)
        return pages.get(page, {"messages": {"pages": max(pages), "records": []}})

    monkeypatch.setattr(whatsapp_history, "find_chat_messages", fake_find)
    return type("Evolution", (), {"pages": pages, "calls": calls})


def _page(records: list[dict], *, pages: int = 1, current: int = 1) -> dict:
    return {"messages": {"pages": pages, "currentPage": current, "records": records}}


@pytest.mark.asyncio
async def test_devuelve_los_mensajes_en_orden_ascendente(evolution):
    evolution.pages[1] = _page([_record("B", 1_700_000_200), _record("A", 1_700_000_100)])

    result = await fetch_whatsapp_history("chat", None, None)

    assert [i["wa_message_id"] for i in result["items"]] == ["A", "B"]
    assert result["has_more"] is False
    assert result["next_page"] is None


@pytest.mark.asyncio
async def test_excluye_lo_posterior_al_inicio_del_registro(evolution):
    evolution.pages[1] = _page([_record("NUEVO", 1_700_000_500), _record("VIEJO", 1_700_000_100)])
    boundary = datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)  # 1_700_000_000

    result = await fetch_whatsapp_history("chat", 1, boundary)

    assert result["items"] == []


@pytest.mark.asyncio
async def test_excluye_los_mensajes_que_ya_estan_en_la_base(evolution, monkeypatch):
    evolution.pages[1] = _page([_record("A", 1_700_000_100), _record("B", 1_700_000_200)])
    monkeypatch.setattr(
        whatsapp_history, "existing_wa_message_ids", AsyncMock(return_value={"A"})
    )

    result = await fetch_whatsapp_history("chat", None, None)

    assert [i["wa_message_id"] for i in result["items"]] == ["B"]


@pytest.mark.asyncio
async def test_saltea_las_paginas_que_ya_cubre_la_base(evolution, monkeypatch):
    """500 mensajes propios: en vez de recorrer 10 páginas de duplicados,
    arranca en la 9 (una antes del límite, para no pasarse)."""
    monkeypatch.setattr(whatsapp_history, "count_wa_messages", AsyncMock(return_value=500))
    boundary = datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)  # 1_700_000_000
    evolution.pages[9] = _page([_record("YA_REGISTRADO", 1_700_000_500)], pages=10, current=9)
    evolution.pages[10] = _page([_record("A", 1_600_000_000)], pages=10, current=10)

    result = await fetch_whatsapp_history("chat", None, boundary)

    assert evolution.calls == [9, 10]
    assert [i["wa_message_id"] for i in result["items"]] == ["A"]


@pytest.mark.asyncio
async def test_retrocede_cuando_la_estimacion_se_paso_de_largo(evolution, monkeypatch):
    """Si la base tiene huecos, la página estimada cae más atrás que el límite
    y en el medio quedarían mensajes sin mostrar."""
    monkeypatch.setattr(whatsapp_history, "count_wa_messages", AsyncMock(return_value=200))
    boundary = datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)  # 1_700_000_000
    # Página 3 (la estimada) es toda anterior al límite -> retrocede a la 1.
    evolution.pages[3] = _page([_record("VIEJO", 1_600_000_000)], pages=3, current=3)
    evolution.pages[1] = _page([_record("BORDE", 1_699_999_000)], pages=3, current=1)
    evolution.pages[2] = _page([_record("MEDIO", 1_650_000_000)], pages=3, current=2)

    result = await fetch_whatsapp_history("chat", None, boundary)

    assert evolution.calls == [3, 1, 2, 3]
    assert [i["wa_message_id"] for i in result["items"]] == ["VIEJO", "MEDIO", "BORDE"]


@pytest.mark.asyncio
async def test_sigue_paginando_mientras_haya_mas_historial(evolution):
    """Una tanda completa corta ahí y deja el cursor para pedir la siguiente."""
    full_page = [_record(f"X{i}", 1_700_000_100 + i) for i in range(50)]
    evolution.pages[1] = _page(full_page, pages=4, current=1)

    result = await fetch_whatsapp_history("chat", 1, None)

    assert len(result["items"]) == 50
    assert evolution.calls == [1]
    assert result["has_more"] is True
    assert result["next_page"] == 2


@pytest.mark.asyncio
async def test_una_pagina_incompleta_marca_el_fin_sin_metadata(evolution):
    evolution.pages[1] = [_record("A", 1_700_000_100)]  # lista pelada, sin `pages`

    result = await fetch_whatsapp_history("chat", 1, None)

    assert result["has_more"] is False
    assert result["next_page"] is None


@pytest.mark.asyncio
async def test_corta_el_barrido_para_no_colgar_el_request(evolution):
    """Cuando todas las páginas se descartan, se corta y se ofrece continuar."""
    full_page = [_record(f"X{i}", 1_700_000_500 + i) for i in range(50)]
    for page in range(1, 40):
        evolution.pages[page] = _page(full_page, pages=39, current=page)
    boundary = datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)

    result = await fetch_whatsapp_history("chat", 1, boundary)

    assert len(evolution.calls) == whatsapp_history.MAX_EVOLUTION_CALLS
    assert result["items"] == []
    assert result["has_more"] is True
