"""Alta, sincronización y baja de plantillas oficiales, directo contra Meta."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.schemas import TemplateCreate, TemplateMetaImport, TemplateUpdate
from routers import templates
from services import template_validation
from services.meta_service import MetaApiError


def _official_payload(**overrides):
    values = dict(
        name="Recordatorio",
        content="Hola {{1}}, tu cita es el {{2}}.",
        category="Seguimiento",
        template_type="official",
        official_name="recordatorio_cita",
        official_language="es",
        official_category="UTILITY",
        official_parameter_values=["Ana", "martes 10:00"],
        official_header_type="text",
        official_header_text="DermicaPro",
        official_footer="Gracias por tu preferencia",
        official_buttons=[{"type": "quick_reply", "text": "Confirmar"}],
    )
    values.update(overrides)
    return TemplateCreate(**values)


async def _category_found(_name):
    return {"id": 1, "name": "Seguimiento", "is_active": True}


@pytest.mark.asyncio
async def test_official_template_create_sends_full_components_to_meta(monkeypatch):
    sent = None

    async def fake_create_whatsapp_template(name, category, language, components):
        nonlocal sent
        sent = (name, category, language, components)
        return {"id": "meta-123", "status": "PENDING", "category": category}

    received_values = None

    async def fake_create_template(values, user_id):
        nonlocal received_values
        received_values = values
        return {"id": 9, **values, "is_active": True, "visibility": "global",
                "is_favorite": False, "last_used_at": None, "use_count": 0, "attachments": []}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "get_template_category_by_name", _category_found)
    monkeypatch.setattr(templates, "create_whatsapp_template", fake_create_whatsapp_template)
    monkeypatch.setattr(templates, "create_template", fake_create_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    await templates.post_template(_official_payload(), SimpleNamespace(id=11))

    name, category, language, components = sent
    assert (name, category, language) == ("recordatorio_cita", "UTILITY", "es")
    assert components == [
        {"type": "HEADER", "format": "TEXT", "text": "DermicaPro"},
        {"type": "BODY", "text": "Hola {{1}}, tu cita es el {{2}}."},
        {"type": "FOOTER", "text": "Gracias por tu preferencia"},
        {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Confirmar"}]},
    ]
    assert received_values["meta_template_id"] == "meta-123"
    assert received_values["official_status"] == "PENDING"


@pytest.mark.asyncio
async def test_official_template_image_header_uploads_to_meta_and_builds_handle(monkeypatch):
    async def fake_get_media_asset(asset_id):
        assert asset_id == 42
        return {"id": 42, "media_url": "media/foo.jpg", "content_type": "image/jpeg", "filename": "foo.jpg"}

    read_calls = []

    def fake_read_media_bytes(media_url):
        read_calls.append(media_url)
        return b"fake-bytes"

    upload_calls = []

    async def fake_upload_header_media(content, content_type, filename):
        upload_calls.append((content, content_type, filename))
        return "HANDLE_ABC"

    monkeypatch.setattr(template_validation, "get_media_asset", fake_get_media_asset)
    monkeypatch.setattr(template_validation, "read_media_bytes", fake_read_media_bytes)
    monkeypatch.setattr(template_validation, "upload_header_media", fake_upload_header_media)

    values = {
        "content": "Hola {{1}}", "official_header_type": "image",
        "official_header_media_asset_id": 42, "official_footer": None, "official_buttons": [],
    }
    components = await template_validation.build_meta_components(values)

    assert read_calls == ["media/foo.jpg"]
    assert upload_calls == [(b"fake-bytes", "image/jpeg", "foo.jpg")]
    assert components[0] == {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": ["HANDLE_ABC"]}}
    assert components[1] == {"type": "BODY", "text": "Hola {{1}}"}


@pytest.mark.asyncio
async def test_official_template_create_surfaces_meta_rejection(monkeypatch):
    async def fake_create_whatsapp_template(*_args, **_kwargs):
        raise MetaApiError(
            "Meta Graph API respondió 400: ...",
            error={"error_user_msg": "El nombre ya existe"},
        )

    monkeypatch.setattr(templates, "get_template_category_by_name", _category_found)
    monkeypatch.setattr(templates, "create_whatsapp_template", fake_create_whatsapp_template)

    with pytest.raises(HTTPException) as error:
        await templates.post_template(_official_payload(), SimpleNamespace(id=11))

    assert error.value.status_code == 502
    assert error.value.detail == "El nombre ya existe"


@pytest.mark.asyncio
async def test_sync_endpoint_updates_local_status_from_meta(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return [{
            "id": 9, "template_type": "official", "meta_template_id": "meta-123",
            "official_status": "PENDING", "attachments": [],
        }]

    async def fake_list_whatsapp_templates():
        return [{"id": "meta-123", "status": "APPROVED", "rejected_reason": "NONE"}]

    received = None

    async def fake_update_template(template_id, values):
        nonlocal received
        received = (template_id, values)
        return {"id": template_id, "official_status": values["official_status"]}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)
    monkeypatch.setattr(templates, "list_whatsapp_templates", fake_list_whatsapp_templates)
    monkeypatch.setattr(templates, "update_template", fake_update_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    result = await templates.post_sync_template(9, SimpleNamespace(id=11))

    assert received == (9, {"official_status": "APPROVED", "official_rejected_reason": None})
    assert result["official_status"] == "APPROVED"


@pytest.mark.asyncio
async def test_sync_endpoint_saves_rejection_reason_from_meta(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return [{
            "id": 9, "template_type": "official", "meta_template_id": "meta-123",
            "official_status": "PENDING", "attachments": [],
        }]

    async def fake_list_whatsapp_templates():
        return [{"id": "meta-123", "status": "REJECTED", "rejected_reason": "TAG_CONTENT_MISMATCH"}]

    received = None

    async def fake_update_template(template_id, values):
        nonlocal received
        received = (template_id, values)
        return {"id": template_id, **values}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)
    monkeypatch.setattr(templates, "list_whatsapp_templates", fake_list_whatsapp_templates)
    monkeypatch.setattr(templates, "update_template", fake_update_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    result = await templates.post_sync_template(9, SimpleNamespace(id=11))

    assert received == (9, {"official_status": "REJECTED", "official_rejected_reason": "TAG_CONTENT_MISMATCH"})
    assert result["official_rejected_reason"] == "TAG_CONTENT_MISMATCH"


@pytest.mark.asyncio
async def test_patch_blocks_renaming_official_template_already_sent_to_meta(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return [{
            "id": 9, "name": "Recordatorio", "content": "Hola {{1}}", "category": "Seguimiento",
            "template_type": "official", "official_name": "recordatorio_cita",
            "official_language": "es", "official_category": "UTILITY", "official_status": "APPROVED",
            "official_parameter_values": ["Ana"], "meta_template_id": "meta-123",
            "official_header_type": "none", "official_header_text": None, "official_footer": None,
            "official_buttons": [], "interactive_type": "none", "interactive_config": {},
            "attachments": [], "stage": None, "task_type": None, "service": None, "shortcut": None,
        }]

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)

    with pytest.raises(HTTPException) as error:
        await templates.patch_template(
            9, TemplateUpdate(official_name="otro_nombre"), SimpleNamespace(id=11, role="admin"),
        )

    assert error.value.status_code == 400
    assert "no se pueden cambiar" in error.value.detail


@pytest.mark.asyncio
async def test_import_meta_template_links_without_recreating_on_meta(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return [{"id": 1, "meta_template_id": "meta-other"}]

    async def fake_get_whatsapp_template(meta_template_id):
        assert meta_template_id == "meta-999"
        return {
            "id": "meta-999", "name": "bienvenida_cliente", "status": "APPROVED",
            "category": "MARKETING", "language": "es", "rejected_reason": "NONE",
            "components": [
                {"type": "HEADER", "format": "TEXT", "text": "DermicaPro"},
                {"type": "BODY", "text": "Hola {{1}}, bienvenido."},
                {"type": "FOOTER", "text": "Gracias"},
                {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Ver más"}]},
            ],
        }

    async def fake_category_found(name):
        return {"id": 1, "name": name, "is_active": True}

    received_values = None

    async def fake_create_template(values, user_id):
        nonlocal received_values
        received_values = values
        return {"id": 5, **values, "is_active": True, "visibility": "global",
                "is_favorite": False, "last_used_at": None, "use_count": 0, "attachments": []}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)
    monkeypatch.setattr(templates, "get_whatsapp_template", fake_get_whatsapp_template)
    monkeypatch.setattr(templates, "get_template_category_by_name", fake_category_found)
    monkeypatch.setattr(templates, "create_template", fake_create_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    body = TemplateMetaImport(name="Bienvenida", category="Seguimiento", official_parameter_values=["{{nombre}}"])
    result = await templates.post_import_meta_template("meta-999", body, SimpleNamespace(id=11))

    assert result["id"] == 5
    assert received_values["meta_template_id"] == "meta-999"
    assert received_values["official_name"] == "bienvenida_cliente"
    assert received_values["official_status"] == "APPROVED"
    assert received_values["content"] == "Hola {{1}}, bienvenido."
    assert received_values["official_header_type"] == "text"
    assert received_values["official_header_text"] == "DermicaPro"
    assert received_values["official_footer"] == "Gracias"
    assert received_values["official_buttons"] == [{"type": "quick_reply", "text": "Ver más"}]
    assert received_values["official_parameter_values"] == ["{{nombre}}"]


@pytest.mark.asyncio
async def test_import_meta_template_rejects_already_linked(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return [{"id": 1, "meta_template_id": "meta-999"}]

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)

    body = TemplateMetaImport(name="Bienvenida", category="Seguimiento")
    with pytest.raises(HTTPException) as error:
        await templates.post_import_meta_template("meta-999", body, SimpleNamespace(id=11))

    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_import_meta_template_requires_all_parameter_values(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return []

    async def fake_get_whatsapp_template(_meta_template_id):
        return {
            "id": "meta-999", "name": "bienvenida_cliente", "status": "APPROVED",
            "category": "MARKETING", "language": "es",
            "components": [{"type": "BODY", "text": "Hola {{1}}, tu turno es {{2}}."}],
        }

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)
    monkeypatch.setattr(templates, "get_whatsapp_template", fake_get_whatsapp_template)

    body = TemplateMetaImport(name="Bienvenida", category="Seguimiento", official_parameter_values=["Ana"])
    with pytest.raises(HTTPException) as error:
        await templates.post_import_meta_template("meta-999", body, SimpleNamespace(id=11))

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_import_meta_template_image_header_falls_back_to_none(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return []

    async def fake_get_whatsapp_template(_meta_template_id):
        return {
            "id": "meta-999", "name": "promo_verano", "status": "APPROVED",
            "category": "MARKETING", "language": "es",
            "components": [
                {"type": "HEADER", "format": "IMAGE"},
                {"type": "BODY", "text": "Hola, aprovecha nuestra promo."},
            ],
        }

    async def fake_category_found(name):
        return {"id": 1, "name": name, "is_active": True}

    received_values = None

    async def fake_create_template(values, user_id):
        nonlocal received_values
        received_values = values
        return {"id": 5, **values, "is_active": True, "visibility": "global",
                "is_favorite": False, "last_used_at": None, "use_count": 0, "attachments": []}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)
    monkeypatch.setattr(templates, "get_whatsapp_template", fake_get_whatsapp_template)
    monkeypatch.setattr(templates, "get_template_category_by_name", fake_category_found)
    monkeypatch.setattr(templates, "create_template", fake_create_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    body = TemplateMetaImport(name="Promo", category="Seguimiento")
    await templates.post_import_meta_template("meta-999", body, SimpleNamespace(id=11))

    assert received_values["official_header_type"] == "none"
    assert received_values["official_header_media_asset_id"] is None


@pytest.mark.asyncio
async def test_import_meta_template_downloads_image_header_example(monkeypatch):
    async def fake_list_templates(_user_id, _include_inactive):
        return []

    async def fake_get_whatsapp_template(_meta_template_id):
        return {
            "id": "meta-999", "name": "promo_verano", "status": "APPROVED",
            "category": "MARKETING", "language": "es",
            "components": [
                {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": ["https://cdn.meta.example/foo.jpg"]}},
                {"type": "BODY", "text": "Hola, aprovecha nuestra promo."},
            ],
        }

    async def fake_download(url):
        assert url == "https://cdn.meta.example/foo.jpg"
        return b"fake-image-bytes", "image/jpeg"

    def fake_save_media_file(content_type, data_base64, filename):
        assert content_type == "image/jpeg"
        assert filename == "promo_verano.jpeg"
        return "media/promo_verano.jpeg"

    def fake_media_size(media_url):
        return 123

    async def fake_create_media_asset(media_url, content_type, filename, size_bytes, user_id):
        return {"id": 77, "media_url": media_url, "content_type": content_type, "filename": filename}

    async def fake_category_found(name):
        return {"id": 1, "name": name, "is_active": True}

    received_values = None

    async def fake_create_template(values, user_id):
        nonlocal received_values
        received_values = values
        return {"id": 5, **values, "is_active": True, "visibility": "global",
                "is_favorite": False, "last_used_at": None, "use_count": 0, "attachments": []}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "list_templates", fake_list_templates)
    monkeypatch.setattr(templates, "get_whatsapp_template", fake_get_whatsapp_template)
    monkeypatch.setattr(templates, "download_template_header_example", fake_download)
    monkeypatch.setattr(templates, "save_media_file", fake_save_media_file)
    monkeypatch.setattr(templates, "media_size", fake_media_size)
    monkeypatch.setattr(templates, "create_media_asset", fake_create_media_asset)
    monkeypatch.setattr(templates, "get_template_category_by_name", fake_category_found)
    monkeypatch.setattr(templates, "create_template", fake_create_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    body = TemplateMetaImport(name="Promo", category="Seguimiento")
    await templates.post_import_meta_template("meta-999", body, SimpleNamespace(id=11))

    assert received_values["official_header_type"] == "image"
    assert received_values["official_header_media_asset_id"] == 77


@pytest.mark.asyncio
async def test_delete_cleans_up_meta_template_after_local_delete(monkeypatch):
    async def fake_delete_template_record(_template_id):
        return {"template_type": "official", "official_name": "recordatorio_cita", "meta_template_id": "meta-123"}

    deleted_with = None

    async def fake_delete_whatsapp_template(name, meta_template_id):
        nonlocal deleted_with
        deleted_with = (name, meta_template_id)
        return {"success": True}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "delete_template_record", fake_delete_template_record)
    monkeypatch.setattr(templates, "delete_whatsapp_template", fake_delete_whatsapp_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    result = await templates.delete_template(9, SimpleNamespace(id=11))

    assert deleted_with == ("recordatorio_cita", "meta-123")
    assert result == {"status": "ok"}


@pytest.mark.asyncio
async def test_delete_of_imported_template_never_touches_meta(monkeypatch):
    """Una plantilla vinculada con 'Importar desde Meta' ya existía y fue
    aprobada fuera de la app: borrar el vínculo local no debe borrar la
    plantilla real de la WABA (a diferencia de una creada acá)."""
    async def fake_delete_template_record(_template_id):
        return {
            "template_type": "official", "official_name": "promo_verano",
            "meta_template_id": "meta-999", "imported_from_meta": True,
        }

    async def fake_delete_whatsapp_template(*_args, **_kwargs):
        raise AssertionError("no debería borrarse en Meta una plantilla importada")

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "delete_template_record", fake_delete_template_record)
    monkeypatch.setattr(templates, "delete_whatsapp_template", fake_delete_whatsapp_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    result = await templates.delete_template(9, SimpleNamespace(id=11))

    assert result == {"status": "ok"}
