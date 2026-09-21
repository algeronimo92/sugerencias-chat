from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers.media import get_media_file
from services import media_storage
from tenancy.context import TenantContext, tenant_context


def _tenant(host: str) -> TenantContext:
    return TenantContext(uuid4(), f"tenant_{uuid4().hex}", host)


def _request(method: str = "GET") -> SimpleNamespace:
    return SimpleNamespace(method=method)


def test_minio_object_names_include_immutable_organization_id(monkeypatch) -> None:
    monkeypatch.setattr(media_storage.settings, "minio_prefix", "crm")
    context = _tenant("uno.example.test")

    with tenant_context(context):
        name = media_storage._object_name_from_filename("photo.jpg", "image/jpeg")

    assert name == f"crm/tenants/{context.organization_id}/images/photo.jpg"
    assert context.hostname not in name
    assert context.schema_name not in name


def test_same_filename_resolves_to_different_tenant_directories(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(media_storage, "MEDIA_DIR", tmp_path)
    tenant_a = _tenant("a.example.test")
    tenant_b = _tenant("b.example.test")

    with tenant_context(tenant_a):
        path_a = media_storage._local_path_from_filename("same.jpg")
    with tenant_context(tenant_b):
        path_b = media_storage._local_path_from_filename("same.jpg")

    assert path_a != path_b
    assert str(tenant_a.organization_id) in path_a.parts
    assert str(tenant_b.organization_id) in path_b.parts


def test_legacy_storage_path_is_preserved_without_tenant(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(media_storage, "MEDIA_DIR", tmp_path)
    assert media_storage._local_path_from_filename("legacy.jpg") == tmp_path / "legacy.jpg"


def test_get_media_file_hides_another_tenants_file_behind_404(monkeypatch, tmp_path) -> None:
    """`/media/{filename}` no compara un `organization_id` explícito: el 404 sale
    de que el archivo de un tenant físicamente no existe bajo el directorio del
    otro (ver `_tenant_storage_segment`). Este test prueba el router end-to-end,
    no solo el armado de la ruta, para el checklist §14 del plan multi-tenant
    ("GET/HEAD/Range... validan propiedad en el schema")."""
    monkeypatch.setattr(media_storage, "MEDIA_DIR", tmp_path)
    monkeypatch.setattr(media_storage.settings, "media_storage_backend", "local")
    tenant_a = _tenant("a.example.test")
    tenant_b = _tenant("b.example.test")

    with tenant_context(tenant_a):
        media_storage._local_path_from_filename("secreto.jpg").write_bytes(b"contenido-de-a")

    with tenant_context(tenant_b):
        with pytest.raises(HTTPException) as exc_get:
            get_media_file("secreto.jpg", _request("GET"), None, None)
        assert exc_get.value.status_code == 404

        with pytest.raises(HTTPException) as exc_head:
            get_media_file("secreto.jpg", _request("HEAD"), None, None)
        assert exc_head.value.status_code == 404

        with pytest.raises(HTTPException) as exc_range:
            get_media_file("secreto.jpg", _request("GET"), "bytes=0-3", None)
        assert exc_range.value.status_code == 404

    with tenant_context(tenant_a):
        response = get_media_file("secreto.jpg", _request("HEAD"), None, None)
        assert response.status_code == 200

        range_response = get_media_file("secreto.jpg", _request("GET"), "bytes=0-3", None)
        assert range_response.status_code == 206
