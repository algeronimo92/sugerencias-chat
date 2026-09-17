from uuid import uuid4

from services import media_storage
from tenancy.context import TenantContext, tenant_context


def _tenant(host: str) -> TenantContext:
    return TenantContext(uuid4(), f"tenant_{uuid4().hex}", host)


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
