"""Salida hacia Meta: una sola allowlist, validación y constructores."""

import copy

import pytest

from services import message_outbox, meta_outbound
from services.meta_outbound import (
    OutboundRejected,
    contacts_item,
    interactive_item,
    location_item,
    media_item,
    reaction_message,
    require_capabilities,
    sticker_item,
    template_item,
    text_item,
    validate_message,
    validation_errors,
    with_context,
)
from tests.meta_fixtures import outbound_cases


@pytest.mark.parametrize("name", sorted(outbound_cases()))
def test_every_official_outbound_fixture_is_accepted(name):
    assert validation_errors(outbound_cases()[name], final=True) == []


@pytest.mark.parametrize(
    "root", ["button", "order", "system", "unknown", "unsupported", "contact", "poll", "ptv", "product"]
)
def test_roots_meta_does_not_send_are_rejected(root):
    with pytest.raises(OutboundRejected, match="no permite enviar"):
        validate_message({"type": root, root: {}})


@pytest.mark.parametrize("subtype", ["buttons", "button_reply", "list_reply", "nfm_reply"])
def test_interactive_subtypes_meta_does_not_send_are_rejected(subtype):
    message = copy.deepcopy(outbound_cases()["interactive_button"])
    message["interactive"]["type"] = subtype
    with pytest.raises(OutboundRejected, match=f"interactive/{subtype}"):
        validate_message(message)


def test_non_reply_buttons_are_rejected_instead_of_becoming_text():
    message = copy.deepcopy(outbound_cases()["interactive_button"])
    message["interactive"]["action"]["buttons"][0] = {"type": "url", "url": "https://example.com"}
    errors = validation_errors(message, final=True)
    assert any("reply" in error for error in errors)


def test_limits_come_from_the_contract():
    message = copy.deepcopy(outbound_cases()["interactive_button"])
    message["interactive"]["action"]["buttons"][0]["reply"]["title"] = "x" * 21
    assert any("máximo 20" in error for error in validation_errors(message, final=True))
    message = copy.deepcopy(outbound_cases()["interactive_button"])
    message["interactive"]["action"]["buttons"] *= 2
    assert any("entre 1 y 3" in error for error in validation_errors(message, final=True))


def test_unknown_root_fields_are_rejected():
    message = {**outbound_cases()["text"], "_actor_user_id": 1}
    assert validation_errors(message, final=False) == ["Campos que Meta no acepta: _actor_user_id"]


def test_media_needs_an_id_only_when_final():
    message = media_item("/media/a.jpg", "image", caption="Hola")["message"]
    assert validation_errors(message, final=False) == []
    assert validation_errors(message, final=True) == ["image necesita id o link"]


def test_builders_produce_the_exact_meta_structure():
    assert text_item("Hola")["message"] == {"type": "text", "text": {"body": "Hola"}}
    assert media_item("/media/v.ogg", "audio", content_type="audio/ogg; codecs=opus")["message"] == {
        "type": "audio", "audio": {"voice": True},
    }
    assert media_item("/media/p.pdf", "document", filename="p.pdf", caption="Precios")["message"] == {
        "type": "document", "document": {"caption": "Precios", "filename": "p.pdf"},
    }
    assert sticker_item("/media/s.png")["media"]["as_sticker"] is True
    assert location_item(-12.0, -77.0)["message"] == {
        "type": "location", "location": {"latitude": -12.0, "longitude": -77.0},
    }
    contacts = contacts_item([{"full_name": "Ana Pérez", "phone": "51912345678"}])["message"]
    assert contacts == {
        "type": "contacts",
        "contacts": [{
            "name": {"formatted_name": "Ana Pérez", "first_name": "Ana", "last_name": "Pérez"},
            "phones": [{"phone": "+51912345678", "type": "CELL", "wa_id": "51912345678"}],
        }],
    }
    assert reaction_message("wamid.X", "") == {"type": "reaction", "reaction": {"message_id": "wamid.X", "emoji": ""}}
    template = template_item(name="hola", language="es", components=[], rendered_body="Hola", display={"footer": "x"})
    assert template["message"] == {"type": "template", "template": {"name": "hola", "language": {"code": "es"}}}
    assert template["payload"] == {"template": {"footer": "x"}}
    interactive = outbound_cases()["interactive_list"]["interactive"]
    assert interactive_item(interactive)["content"] == "Elige un servicio"


def test_reply_context_is_meta_context():
    assert with_context(text_item("Hola")["message"], "wamid.Q") == {
        "type": "text", "text": {"body": "Hola"}, "context": {"message_id": "wamid.Q"},
    }
    reaction = reaction_message("wamid.X", "👍")
    assert with_context(reaction, "wamid.Q") == reaction


@pytest.mark.parametrize(
    ("fixture", "settings", "allowed"),
    [
        ("interactive_product", {"meta_catalog_id": ""}, False),
        ("interactive_product", {"meta_catalog_id": "1234567890"}, True),
        ("interactive_product", {"meta_catalog_id": "otro"}, False),
        ("interactive_product_list", {"meta_catalog_id": "1234567890"}, True),
        ("interactive_catalog_message", {"meta_catalog_id": ""}, False),
        ("interactive_flow", {"meta_published_flow_ids": ""}, False),
        ("interactive_flow", {"meta_published_flow_ids": "111, 987654321"}, True),
        ("interactive_call_permission_request", {"meta_call_permission_enabled": ""}, False),
        ("interactive_call_permission_request", {"meta_call_permission_enabled": "true"}, True),
        ("interactive_button", {}, True),
        ("template", {}, True),
    ],
)
@pytest.mark.asyncio
async def test_conditioned_outputs_require_the_account_capability(monkeypatch, fixture, settings, allowed):
    values = {"meta_catalog_id": "", "meta_published_flow_ids": "", "meta_call_permission_enabled": "", **settings}

    async def get_effective_many(keys):
        return {key: values[key] for key in keys}

    monkeypatch.setattr(meta_outbound, "get_effective_many", get_effective_many)
    message = outbound_cases()[fixture]
    if allowed:
        await require_capabilities(message)
    else:
        with pytest.raises(OutboundRejected) as exc:
            await require_capabilities(message)
        assert exc.value.reason == "capability"


class _Sender:
    def __init__(self):
        self.uploads = []

    async def upload_media(self, content, content_type, filename):
        self.uploads.append((content, content_type, filename))
        return f"MEDIA_{len(self.uploads)}"


@pytest.mark.asyncio
async def test_worker_completes_media_and_template_header_only_at_send_time(monkeypatch):
    sender = _Sender()
    monkeypatch.setattr(message_outbox, "current_channel", lambda: type("C", (), {"sender": sender})())
    monkeypatch.setattr(message_outbox, "stat_media", lambda url: type("S", (), {"content_type": "image/png"})())
    monkeypatch.setattr(message_outbox, "read_media_bytes", lambda url: b"png")
    monkeypatch.setattr(message_outbox, "image_to_sticker_webp", lambda data: b"webp")

    item = media_item("/media/foto.png", "image", caption="Mirá")
    final = await message_outbox.build_final_message({"message": item["message"], "media": item["media"]})
    assert final == {"type": "image", "image": {"caption": "Mirá", "id": "MEDIA_1"}}
    assert item["message"] == {"type": "image", "image": {"caption": "Mirá"}}

    sticker = sticker_item("/media/s.png")
    final = await message_outbox.build_final_message({"message": sticker["message"], "media": sticker["media"]})
    assert final == {"type": "sticker", "sticker": {"id": "MEDIA_2"}}
    assert sender.uploads[-1] == (b"webp", "image/webp", "sticker.webp")

    template = template_item(
        name="promo", language="es", components=[{"type": "body", "parameters": []}], rendered_body="Hola",
        header_media={"media_url": "/media/h.png", "filename": "h.png"},
    )
    final = await message_outbox.build_final_message(
        {"message": template["message"], "header_media": template["header_media"]}
    )
    assert final["template"]["components"][0] == {
        "type": "header", "parameters": [{"type": "image", "image": {"id": "MEDIA_3"}}],
    }


@pytest.mark.asyncio
async def test_worker_refuses_jobs_from_the_previous_format():
    with pytest.raises(OutboundRejected) as exc:
        await message_outbox.build_final_message({"type": "text", "text": "hola"})
    assert exc.value.reason == "legacy_job"
    assert message_outbox.classify_send_failure(exc.value) is message_outbox.SendOutcome.DEFINITIVE


def test_sent_body_matches_the_stored_one_apart_from_envelope_and_ids():
    stored = {"type": "image", "image": {"caption": "Mirá"}}
    sent = {
        "messaging_product": "whatsapp", "recipient_type": "individual", "to": "51987654321",
        "type": "image", "image": {"caption": "Mirá", "id": "MEDIA_1"},
    }
    assert message_outbox._payload_matches(stored, sent)
    assert not message_outbox._payload_matches(stored, {**sent, "image": {"caption": "Otra", "id": "M"}})
    stored_template = {"type": "template", "template": {"name": "promo", "language": {"code": "es"}}}
    sent_template = {
        "to": "1", "messaging_product": "whatsapp", "recipient_type": "individual", "type": "template",
        "template": {
            "name": "promo", "language": {"code": "es"},
            "components": [{"type": "header", "parameters": [{"type": "image", "image": {"id": "M"}}]}],
        },
    }
    assert message_outbox._payload_matches(stored_template, sent_template)
