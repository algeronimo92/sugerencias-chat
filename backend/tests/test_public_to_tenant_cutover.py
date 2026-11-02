"""Corte de la instalación single-tenant al primer tenant.

Las dos herramientas corren una sola vez y sobre producción: lo que falle acá
no se nota hasta el día del corte, y ese día ya es tarde.
"""

from types import SimpleNamespace

import pytest

from scripts.copy_legacy_media_to_tenant import copy_legacy_media, destination_for
from scripts.move_public_to_tenant import CONTROL_PLANE_TABLES


def test_platform_tables_stay_in_public() -> None:
    """Si el corte se llevara platform_users al schema del negocio, nadie
    podría volver a entrar al panel."""
    for table in (
        "organizations",
        "organization_branding",
        "organization_domains",
        "whatsapp_connections",
        "tenant_schema_versions",
        "platform_settings",
        "platform_users",
        "platform_sessions",
        "webhook_inbox",
        "alembic_version",
        "n8n_chat_histories",
    ):
        assert table in CONTROL_PLANE_TABLES, table


def test_business_tables_move_to_the_tenant() -> None:
    for table in ("users", "leads", "wsp_messages", "appointments", "app_settings", "auth_sessions"):
        assert table not in CONTROL_PLANE_TABLES, table


TENANT = "dermicapro/tenants/25f386c1-e145-463b-b41f-dfd63103a8bf-dermicapro"


@pytest.mark.parametrize(
    ("object_name", "expected"),
    [
        ("dermicapro/images/a.jpg", f"{TENANT}/images/a.jpg"),
        ("dermicapro/audio/nota", f"{TENANT}/audio/nota"),
        # Ya es de un negocio: no se vuelve a anidar.
        ("dermicapro/tenants/otro/images/a.jpg", None),
        # Otro prefijo del mismo bucket: no es de esta instalación.
        ("otra-app/images/a.jpg", None),
        ("dermicapro-viejo/images/a.jpg", None),
    ],
)
def test_destination_for(object_name: str, expected: str | None) -> None:
    assert destination_for(object_name, "dermicapro", TENANT) == expected


def test_destination_without_legacy_prefix() -> None:
    tenant = "tenants/abc"
    assert destination_for("images/a.jpg", "", tenant) == "tenants/abc/images/a.jpg"
    assert destination_for("tenants/abc/images/a.jpg", "", tenant) is None


class NotFound(Exception):
    code = "NoSuchKey"


class FakeMinio:
    def __init__(self, objects: dict[str, int]):
        self.objects = dict(objects)
        self.copies: list[tuple[str, str]] = []

    def list_objects(self, bucket, prefix=None, recursive=False):
        assert recursive
        return [
            SimpleNamespace(object_name=name, size=size)
            for name, size in sorted(self.objects.items())
            if prefix is None or name.startswith(prefix)
        ]

    def stat_object(self, bucket, object_name):
        if object_name not in self.objects:
            raise NotFound()
        return SimpleNamespace(size=self.objects[object_name])

    def copy_object(self, bucket, destination, source):
        self.copies.append((source.object_name, destination))
        self.objects[destination] = self.objects[source.object_name]


def _legacy_bucket() -> FakeMinio:
    return FakeMinio(
        {
            "dermicapro/images/a.jpg": 10,
            "dermicapro/audio/b.ogg": 20,
            "dermicapro/files/c.pdf": 30,
            # Ya copiado en una pasada anterior.
            f"{TENANT}/files/c.pdf": 30,
        }
    )


def test_dry_run_copies_nothing() -> None:
    client = _legacy_bucket()

    resumen = copy_legacy_media(client, "wsp", "dermicapro", TENANT, apply=False)

    assert client.copies == []
    assert resumen["por_copiar"] == 2
    assert resumen["ya_estaban"] == 1
    assert resumen["bytes"] == 30


def test_apply_copies_keeps_originals_and_is_idempotent() -> None:
    client = _legacy_bucket()

    primera = copy_legacy_media(client, "wsp", "dermicapro", TENANT, apply=True)
    segunda = copy_legacy_media(client, "wsp", "dermicapro", TENANT, apply=True)

    assert primera["copiados"] == 2
    assert f"{TENANT}/images/a.jpg" in client.objects
    assert f"{TENANT}/audio/b.ogg" in client.objects
    # Copia, no mueve: el binario single-tenant sigue encontrando todo.
    assert "dermicapro/images/a.jpg" in client.objects
    assert segunda["copiados"] == 0
    assert segunda["ya_estaban"] == 3


def test_never_overwrites_a_different_tenant_object() -> None:
    client = FakeMinio(
        {
            "dermicapro/images/a.jpg": 10,
            f"{TENANT}/images/a.jpg": 99,
        }
    )

    resumen = copy_legacy_media(client, "wsp", "dermicapro", TENANT, apply=True)

    assert client.copies == []
    assert resumen["conflictos"] == [f"{TENANT}/images/a.jpg"]
    assert client.objects[f"{TENANT}/images/a.jpg"] == 99
