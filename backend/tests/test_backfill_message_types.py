from scripts.backfill_message_types import parse_legacy_content


def test_plain_text_stays_text():
    n = parse_legacy_content("hola qué tal")
    assert n.message_type == "text"
    assert n.content == "hola qué tal"
    assert n.analysis is None and n.payload is None


def test_text_tag_unwrapped_to_clean_content():
    n = parse_legacy_content("<text>hola</text>")
    assert n.message_type == "text"
    assert n.content == "hola"


def test_image_splits_caption_from_ai_analysis():
    n = parse_legacy_content("<image>caption real\n\nAnalisis: descripción de la IA</image>")
    assert n.message_type == "image"
    assert n.content == "caption real"
    assert n.analysis == {"summary": "descripción de la IA", "kind": "descripcion", "version": 0}


def test_image_without_caption_or_analysis_is_empty():
    n = parse_legacy_content("<image></image>")
    assert n.message_type == "image"
    assert n.content is None
    assert n.analysis is None


def test_audio_inner_is_transcription_not_caption():
    n = parse_legacy_content("<audio>hola qué tal</audio>")
    assert n.message_type == "audio"
    assert n.content is None
    assert n.analysis == {"summary": "hola qué tal", "kind": "transcripcion", "version": 0}


def test_location_coords_go_to_payload():
    n = parse_legacy_content("<location>-12.04,-77.04</location>")
    assert n.message_type == "location"
    assert n.content is None
    assert n.payload == {"latitude": -12.04, "longitude": -77.04}


def test_location_with_bad_coords_keeps_type_without_payload():
    n = parse_legacy_content("<location>Ubicación</location>")
    assert n.message_type == "location"
    assert n.payload is None


def test_other_becomes_document_with_filename():
    n = parse_legacy_content("<other>presupuesto.pdf</other>")
    assert n.message_type == "document"
    assert n.payload == {"filename": "presupuesto.pdf"}


def test_buttons_response_keeps_selected_text_and_payload():
    raw = '<buttonsResponseMessage>{"selectedDisplayText": "Confirmar", "selectedButtonId": "id1"}</buttonsResponseMessage>'
    n = parse_legacy_content(raw)
    assert n.message_type == "interactive"
    assert n.content == "Confirmar"
    assert n.payload == {"selectedDisplayText": "Confirmar", "selectedButtonId": "id1"}


def test_unknown_tag_falls_back_to_unsupported():
    n = parse_legacy_content("<sticker></sticker>")
    assert n.message_type == "unsupported"
    assert n.payload == {"original_type": "sticker"}


def test_none_and_empty_are_text():
    assert parse_legacy_content(None).message_type == "text"
    assert parse_legacy_content("").message_type == "text"


def test_half_tag_is_not_treated_as_media():
    n = parse_legacy_content("mira <image></image> esto")
    assert n.message_type == "text"
    assert n.content == "mira <image></image> esto"
