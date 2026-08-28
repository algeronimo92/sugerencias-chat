from services.evolution_service import media_message_fields


def test_image_without_album_id_has_no_payload():
    assert media_message_fields("image", None) == ("image", None)


def test_document_keeps_filename_without_album_id():
    assert media_message_fields("document", "factura.pdf") == ("document", {"filename": "factura.pdf"})


def test_image_with_album_id_carries_it_in_payload():
    assert media_message_fields("image", None, "album-123") == ("image", {"album_id": "album-123"})


def test_document_with_album_id_keeps_both_fields():
    assert media_message_fields("document", "factura.pdf", "album-123") == (
        "document", {"filename": "factura.pdf", "album_id": "album-123"},
    )


def test_empty_album_id_is_treated_as_absent():
    assert media_message_fields("video", None, "") == ("video", None)
