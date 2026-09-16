"""Envío de plantillas oficiales: armado de `components` según el formato de
variable de la plantilla (posicional vs con nombre) -- ver 132012 en
services/meta_service.template_parameter_identifiers."""

import pytest

from services import chat_messaging


def _official_template(content, official_parameter_values, **overrides):
    values = dict(
        id=9, template_type="official", official_status="APPROVED",
        official_name="recordatorio_cita", official_language="es",
        content=content, official_parameter_values=official_parameter_values,
        official_header_type="none", official_header_text=None,
        official_header_media_url=None, official_header_media_content_type=None,
        official_header_media_filename=None, official_footer=None, official_buttons=[],
    )
    values.update(overrides)
    return values


@pytest.fixture
def send_deps(monkeypatch):
    sent_items = None

    async def fake_enqueue_messages(_chat_id, items, **_kwargs):
        nonlocal sent_items
        sent_items = items
        return [{"id": 1}]

    async def fake_record_template_use(_template_id, _user_id):
        return None

    async def fake_broadcast(_payload):
        return None

    async def fake_lead_exists(_chat_id):
        return True

    monkeypatch.setattr(chat_messaging, "enqueue_messages", fake_enqueue_messages)
    monkeypatch.setattr(chat_messaging, "record_template_use", fake_record_template_use)
    monkeypatch.setattr(chat_messaging.manager, "broadcast", fake_broadcast)
    monkeypatch.setattr(chat_messaging, "lead_exists", fake_lead_exists)

    def sent():
        return sent_items

    return sent


def _list_templates(monkeypatch, template):
    async def fake_list_templates(_user_id):
        return [template]

    monkeypatch.setattr(chat_messaging, "list_templates", fake_list_templates)


@pytest.mark.asyncio
async def test_send_positional_template_sends_plain_text_parameters(monkeypatch, send_deps):
    template = _official_template("Hola {{1}}, tu cita es el {{2}}.", ["Ana", "martes"])
    _list_templates(monkeypatch, template)

    await chat_messaging.send_template("lead-1", 9, None, ["Ana", "martes"], 11)

    components = send_deps()[0]["payload"]["components"]
    assert components == [{
        "type": "body",
        "parameters": [{"type": "text", "text": "Ana"}, {"type": "text", "text": "martes"}],
    }]
    assert send_deps()[0]["content"] == "Hola Ana, tu cita es el martes."


@pytest.mark.asyncio
async def test_send_named_template_includes_parameter_name(monkeypatch, send_deps):
    template = _official_template(
        "Hola {{cliente}}, tu cita es el {{fecha}}.", ["Ana", "martes"],
    )
    _list_templates(monkeypatch, template)

    await chat_messaging.send_template("lead-1", 9, None, ["Ana", "martes"], 11)

    components = send_deps()[0]["payload"]["components"]
    assert components == [{
        "type": "body",
        "parameters": [
            {"type": "text", "parameter_name": "cliente", "text": "Ana"},
            {"type": "text", "parameter_name": "fecha", "text": "martes"},
        ],
    }]
    assert send_deps()[0]["content"] == "Hola Ana, tu cita es el martes."


@pytest.mark.asyncio
async def test_send_image_header_template_carries_header_media_reference(monkeypatch, send_deps):
    """Una plantilla con encabezado de imagen no sube el archivo acá: solo
    deja la referencia al medio local en el payload. Subirlo recién al
    despachar (`services/outbound_kinds.py`) evita dejar un media id de Meta
    que puede invalidarse antes del envío real (ver 132012 en
    services/meta_service.py)."""
    template = _official_template(
        "Hola {{1}}", ["Ana"],
        official_header_type="image",
        official_header_media_url="/api/media/images/encabezado.jpg",
        official_header_media_content_type="image/jpeg",
        official_header_media_filename="encabezado.jpg",
    )
    _list_templates(monkeypatch, template)

    await chat_messaging.send_template("lead-1", 9, None, ["Ana"], 11)

    assert send_deps()[0]["payload"]["header_media"] == {
        "media_url": "/api/media/images/encabezado.jpg",
        "content_type": "image/jpeg",
        "filename": "encabezado.jpg",
    }


@pytest.mark.asyncio
async def test_send_template_without_image_header_omits_header_media(monkeypatch, send_deps):
    template = _official_template("Hola {{1}}", ["Ana"])
    _list_templates(monkeypatch, template)

    await chat_messaging.send_template("lead-1", 9, None, ["Ana"], 11)

    assert send_deps()[0]["payload"]["header_media"] is None


@pytest.mark.asyncio
async def test_send_template_carries_header_text_footer_and_buttons_for_display(monkeypatch, send_deps):
    """El CRM necesita header/pie/botones para pintar la burbuja completa (ver
    parseOutboundOfficialTemplate en frontend/src/utils/message.ts) aunque
    Meta no los necesite para el envío en sí -ya los conoce por la plantilla
    aprobada- así que tienen que viajar en el payload igual."""
    template = _official_template(
        "Hola {{1}}", ["Ana"],
        official_header_type="text", official_header_text="DermicaPro",
        official_footer="Gracias por tu preferencia",
        official_buttons=[{"type": "quick_reply", "text": "Confirmar"}],
    )
    _list_templates(monkeypatch, template)

    await chat_messaging.send_template("lead-1", 9, None, ["Ana"], 11)

    payload = send_deps()[0]["payload"]
    assert payload["header_text"] == "DermicaPro"
    assert payload["footer"] == "Gracias por tu preferencia"
    assert payload["buttons"] == [{"type": "quick_reply", "text": "Confirmar"}]
