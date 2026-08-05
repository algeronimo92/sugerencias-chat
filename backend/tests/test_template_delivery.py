from types import SimpleNamespace

from services.template_delivery import build_internal_template_items


def attachment(content_type: str, filename: str = "archivo", media_url: str = "/media/archivo"):
    return SimpleNamespace(
        content_type=content_type,
        filename=filename,
        media_url=media_url,
    )


def test_image_template_uses_content_as_native_caption():
    items = build_internal_template_items(
        "Promoción de agosto",
        [attachment("image/jpeg", "promo.jpg", "/media/promo.jpg")],
    )

    assert items == [{
        "content": "Promoción de agosto",
        "media_url": "/media/promo.jpg",
        "payload": {
            "type": "media",
            "media_url": "/media/promo.jpg",
            "mediatype": "image",
            "filename": "promo.jpg",
            "caption": "Promoción de agosto",
        },
    }]


def test_dict_attachments_are_supported_by_manual_template_route():
    items = build_internal_template_items("Mira el video", [{
        "content_type": "video/mp4",
        "filename": "demo.mp4",
        "media_url": "/media/demo.mp4",
    }])

    assert len(items) == 1
    assert items[0]["payload"]["mediatype"] == "video"
    assert items[0]["payload"]["caption"] == "Mira el video"


def test_long_content_falls_back_to_text_without_truncation():
    text = "x" * 1025
    items = build_internal_template_items(text, [attachment("image/png")])

    assert items[0] == {"content": text, "payload": {"type": "text", "text": text}}
    assert items[1]["payload"]["caption"] is None


def test_audio_does_not_receive_native_caption():
    items = build_internal_template_items("Escucha esto", [attachment("audio/ogg")])

    assert items[0]["payload"] == {"type": "text", "text": "Escucha esto"}
    assert items[1]["payload"]["mediatype"] == "audio"
    assert items[1]["payload"]["caption"] is None
