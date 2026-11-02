"""Corte de la instalación single-tenant al primer tenant.

Estas herramientas corren una sola vez y sobre producción: lo que falle acá
no se nota hasta el día del corte, y ese día ya es tarde.
"""

import base64
import hashlib
from types import SimpleNamespace

import pytest

from app.core import secret_cipher
from scripts.copy_legacy_media_to_tenant import copy_legacy_media, destination_for
from scripts.move_public_to_tenant import CONTROL_PLANE_TABLES, SHARED_TABLES
from scripts.rekey_settings import RekeyError, old_keys, rekey_value


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


def test_platform_login_throttle_survives_the_cutover() -> None:
    """El panel limita los intentos de login en public.auth_login_throttles.
    La tabla se mueve con el negocio (el CRM la usa en el tenant), así que el
    corte tiene que volver a crearla vacía en public."""
    assert "auth_login_throttles" in SHARED_TABLES
    assert "auth_login_throttles" not in CONTROL_PLANE_TABLES
    assert not SHARED_TABLES & CONTROL_PLANE_TABLES


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


class FakeResponse:
    def __init__(self, data: bytes):
        self.data = data

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            chunk, self.data = self.data, b""
        else:
            chunk, self.data = self.data[:size], self.data[size:]
        return chunk

    def close(self):
        pass

    def release_conn(self):
        pass


class FakeMinio:
    """Un MinIO en memoria. `readable` son los buckets que esta credencial
    puede usar, como las políticas de verdad."""

    def __init__(self, objects: dict[tuple[str, str], bytes], readable: set[str]):
        self.objects = objects
        self.readable = readable
        self.copies: list[tuple[str, str]] = []
        self.uploads: list[tuple[str, str, dict]] = []
        self.removed: list[tuple[str, str]] = []
        # sha256 que se informa en vez del real, para simular una copia que
        # tiene el mismo tamaño pero otro contenido.
        self.sha_override: dict[tuple[str, str], str] = {}

    def _check(self, bucket):
        if bucket not in self.readable:
            raise PermissionError(f"AccessDenied {bucket}")

    def list_objects(self, bucket, prefix=None, recursive=False):
        assert recursive
        self._check(bucket)
        return [
            SimpleNamespace(object_name=name, size=len(data))
            for (b, name), data in sorted(self.objects.items())
            if b == bucket and (prefix is None or name.startswith(prefix))
        ]

    def stat_object(self, bucket, object_name):
        self._check(bucket)
        if (bucket, object_name) not in self.objects:
            raise NotFound()
        data = self.objects[(bucket, object_name)]
        sha = self.sha_override.get((bucket, object_name), hashlib.sha256(data).hexdigest())
        return SimpleNamespace(
            size=len(data),
            content_type="image/jpeg",
            metadata={"Content-Type": "image/jpeg", "x-amz-meta-sha256": sha},
        )

    def remove_object(self, bucket, object_name):
        self._check(bucket)
        self.removed.append((bucket, object_name))
        del self.objects[(bucket, object_name)]

    def get_object(self, bucket, object_name):
        self._check(bucket)
        return FakeResponse(self.objects[(bucket, object_name)])

    def copy_object(self, bucket, destination, source):
        self._check(source.bucket_name)
        self._check(bucket)
        self.copies.append((source.object_name, destination))
        self.objects[(bucket, destination)] = self.objects[(source.bucket_name, source.object_name)]

    def put_object(self, bucket, name, data, length, content_type, metadata):
        self._check(bucket)
        self.uploads.append((bucket, name, metadata))
        self.objects[(bucket, name)] = data.read(length)


NEW_TENANT = "tenants/25f386c1-e145-463b-b41f-dfd63103a8bf-dermicapro"


def _legacy_objects() -> dict[tuple[str, str], bytes]:
    return {
        ("wsp", "media/images/a.jpg"): b"x" * 10,
        ("wsp", "media/audio/b.ogg"): b"y" * 20,
        ("wsp", "media/files/c.pdf"): b"z" * 30,
        # Ya copiado en una pasada anterior.
        ("cliniventas", f"{NEW_TENANT}/files/c.pdf"): b"z" * 30,
    }


def _copy(source, dest, apply: bool, workers: int = 1) -> dict:
    return copy_legacy_media(source, "wsp", "media", dest, "cliniventas", NEW_TENANT, apply, workers=workers)


@pytest.mark.parametrize("workers", [1, 4])
def test_same_credential_copies_inside_minio(workers: int) -> None:
    """Variante A: la credencial nueva tiene lectura sobre el bucket viejo."""
    client = FakeMinio(_legacy_objects(), readable={"wsp", "cliniventas"})

    seco = _copy(client, client, apply=False, workers=workers)
    assert client.copies == []
    assert (seco["por_copiar"], seco["ya_estaban"], seco["bytes"]) == (2, 1, 30)

    primera = _copy(client, client, apply=True, workers=workers)
    segunda = _copy(client, client, apply=True, workers=workers)

    assert primera["copiados"] == 2 and not primera["errores"]
    assert ("cliniventas", f"{NEW_TENANT}/images/a.jpg") in client.objects
    # Copia, no mueve: la instalación anterior sigue encontrando todo.
    assert ("wsp", "media/images/a.jpg") in client.objects
    assert (segunda["copiados"], segunda["ya_estaban"]) == (0, 3)


def test_separate_credentials_stream_and_keep_metadata() -> None:
    """Variante B: cada credencial ve solo su bucket."""
    objects = _legacy_objects()
    old = FakeMinio(objects, readable={"wsp"})
    new = FakeMinio(objects, readable={"cliniventas"})

    resumen = _copy(old, new, apply=True, workers=2)

    assert resumen["copiados"] == 2 and not resumen["errores"]
    assert objects[("cliniventas", f"{NEW_TENANT}/audio/b.ogg")] == b"y" * 20
    assert all(meta == {"sha256": hashlib.sha256(objects[(b, n)]).hexdigest()} for b, n, meta in new.uploads)
    assert new.copies == []


def test_never_overwrites_a_different_tenant_object() -> None:
    objects = {
        ("wsp", "media/images/a.jpg"): b"x" * 10,
        ("cliniventas", f"{NEW_TENANT}/images/a.jpg"): b"distinto" * 10,
    }
    client = FakeMinio(objects, readable={"wsp", "cliniventas"})

    resumen = _copy(client, client, apply=True)

    assert client.copies == []
    assert resumen["conflictos"] == [f"{NEW_TENANT}/images/a.jpg"]


def test_copy_errors_are_reported_not_hidden() -> None:
    """Variante A sin el permiso de lectura: cada objeto falla y se informa."""
    client = FakeMinio(_legacy_objects(), readable={"wsp", "cliniventas"})

    def denied(*args, **kwargs):
        raise PermissionError("AccessDenied wsp")

    client.copy_object = denied
    resumen = _copy(client, client, apply=True)

    assert resumen["copiados"] == 0
    assert len(resumen["errores"]) == 2


def _move(source, dest, apply: bool, workers: int = 1) -> dict:
    return copy_legacy_media(
        source, "wsp", "media", dest, "cliniventas", NEW_TENANT, apply, workers=workers, delete_source=True,
    )


def test_delete_source_dry_run_deletes_nothing() -> None:
    objects = _legacy_objects()
    old = FakeMinio(objects, readable={"wsp"})
    new = FakeMinio(objects, readable={"cliniventas"})

    resumen = _move(old, new, apply=False)

    assert old.removed == []
    # c.pdf ya está copiado; a.jpg y b.ogg se borrarían después de copiarse.
    assert (resumen["por_borrar"], resumen["bytes_liberados"]) == (3, 60)
    assert ("wsp", "media/files/c.pdf") in objects


@pytest.mark.parametrize("workers", [1, 4])
def test_delete_source_moves_everything_verified(workers: int) -> None:
    """Lo ya copiado se borra del origen, y lo que falta se copia y se borra:
    el espacio total no crece."""
    objects = _legacy_objects()
    old = FakeMinio(objects, readable={"wsp"})
    new = FakeMinio(objects, readable={"cliniventas"})

    resumen = _move(old, new, apply=True, workers=workers)

    assert not resumen["errores"] and not resumen["conflictos"]
    assert (resumen["copiados"], resumen["ya_estaban"], resumen["borrados"]) == (2, 1, 3)
    assert not any(bucket == "wsp" for bucket, _ in objects)
    assert objects[("cliniventas", f"{NEW_TENANT}/images/a.jpg")] == b"x" * 10


def test_delete_source_keeps_the_original_when_sha_differs() -> None:
    """Mismo tamaño pero otro sha256: no es la misma copia y no se borra."""
    objects = _legacy_objects()
    old = FakeMinio(objects, readable={"wsp"})
    new = FakeMinio(objects, readable={"cliniventas"})
    new.sha_override[("cliniventas", f"{NEW_TENANT}/files/c.pdf")] = "otro"

    resumen = _move(old, new, apply=True)

    assert ("wsp", "media/files/c.pdf") in objects
    assert resumen["conflictos"] == [f"{NEW_TENANT}/files/c.pdf"]
    assert resumen["borrados"] == 2


def test_delete_source_keeps_the_original_when_the_copy_fails() -> None:
    objects = _legacy_objects()
    old = FakeMinio(objects, readable={"wsp"})
    new = FakeMinio(objects, readable={"cliniventas"})

    def disco_lleno(*args, **kwargs):
        raise RuntimeError("XMinioStorageFull")

    new.put_object = disco_lleno
    resumen = _move(old, new, apply=True)

    assert len(resumen["errores"]) == 2
    assert ("wsp", "media/images/a.jpg") in objects
    assert ("wsp", "media/audio/b.ogg") in objects
    # Lo que sí estaba copiado se libera igual: es lo que hace sitio.
    assert old.removed == [("wsp", "media/files/c.pdf")]


# --- re-cifrado ---------------------------------------------------------------

OLD_KEY = base64.urlsafe_b64encode(b"o" * 32).decode()
NEW_KEY = base64.urlsafe_b64encode(b"n" * 32).decode()


def _encrypt_with(monkeypatch, key: str, setting: str, value: str, namespace: str) -> str:
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", key)
    return secret_cipher.encrypt_secret(setting, value, namespace=namespace)


def test_rekey_moves_old_ciphertext_to_the_new_key(monkeypatch) -> None:
    viejo = _encrypt_with(monkeypatch, OLD_KEY, "n8n_webhook_token", "secreto", "app_settings")
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", NEW_KEY)
    keys = old_keys({"OLD_SETTINGS_ENCRYPTION_KEY": OLD_KEY})

    nuevo = rekey_value(viejo, "n8n_webhook_token", ("app_settings",), keys)

    assert nuevo is not None and nuevo != viejo
    assert secret_cipher.decrypt_secret("n8n_webhook_token", nuevo) == "secreto"
    # Segunda pasada: ya está con la clave actual, no se toca.
    assert rekey_value(nuevo, "n8n_webhook_token", ("app_settings",), keys) is None


def test_rekey_reads_values_encrypted_with_the_old_secret_key(monkeypatch) -> None:
    monkeypatch.setattr(secret_cipher.settings, "secret_key", "secret-viejo")
    viejo = _encrypt_with(monkeypatch, "", "elevenlabs_api_key", "k", "app_settings")
    monkeypatch.setattr(secret_cipher.settings, "secret_key", "secret-nuevo")
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", NEW_KEY)

    nuevo = rekey_value(viejo, "elevenlabs_api_key", ("app_settings",), old_keys({"OLD_SECRET_KEY": "secret-viejo"}))

    assert secret_cipher.decrypt_secret("elevenlabs_api_key", nuevo) == "k"


def test_rekey_moves_totp_from_public_to_tenant_namespace(monkeypatch) -> None:
    viejo = _encrypt_with(monkeypatch, OLD_KEY, "user:1", "JBSWY3DP", "admin_totp:public")
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", NEW_KEY)
    tenant_ns = "admin_totp:tenant_25f386c1e145463bb41fdfd63103a8bf"
    keys = old_keys({"OLD_SETTINGS_ENCRYPTION_KEY": OLD_KEY})

    nuevo = rekey_value(viejo, "user:1", (tenant_ns, "admin_totp:public"), keys)

    assert secret_cipher.decrypt_secret("user:1", nuevo, namespace=tenant_ns) == "JBSWY3DP"


def test_rekey_leaves_plain_settings_alone(monkeypatch) -> None:
    """app_settings mezcla secretos con ajustes comunes; el texto plano no se
    cifra porque el script no sabe cuáles son secretos."""
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", NEW_KEY)

    assert rekey_value("51", "default_country_code", ("app_settings",), []) is None


def test_rekey_refuses_what_no_key_opens(monkeypatch) -> None:
    ajena = base64.urlsafe_b64encode(b"x" * 32).decode()
    otro = _encrypt_with(monkeypatch, ajena, "k", "v", "app_settings")
    monkeypatch.setattr(secret_cipher.settings, "settings_encryption_key", NEW_KEY)

    with pytest.raises(RekeyError):
        rekey_value(otro, "k", ("app_settings",), old_keys({"OLD_SETTINGS_ENCRYPTION_KEY": OLD_KEY}))
