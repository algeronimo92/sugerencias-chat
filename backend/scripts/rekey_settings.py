"""Re-cifra los secretos guardados en PostgreSQL con la clave actual.

Hace falta cuando cambia ``SETTINGS_ENCRYPTION_KEY`` (o ``SECRET_KEY`` en una
instalación sin clave explícita): ``secret_cipher`` solo conoce una clave y su
derivada de ``SECRET_KEY``, así que lo cifrado con la anterior deja de abrirse
y el backend falla al leer ajustes.

La clave anterior se pasa por entorno, nunca por argumentos (quedaría en
``ps`` y en el historial):

    OLD_SETTINGS_ENCRYPTION_KEY  la SETTINGS_ENCRYPTION_KEY anterior
    OLD_SECRET_KEY               la SECRET_KEY anterior, para lo que se cifró
                                 sin clave explícita

Cubre ``platform_settings``, ``app_settings`` y ``admin_totp`` en ``public`` y
en el schema de cada organización. El TOTP lleva el schema en el AAD: lo que
se cifró en ``public`` y llegó al tenant con el corte se re-cifra con el
namespace del tenant.

Es idempotente: lo que ya abre con la clave actual se deja como está, y el
texto plano no se toca (no todo en ``app_settings`` es secreto). Sin
``--apply`` solo informa, y si algo no abre con ninguna clave aborta sin
escribir nada.

Uso (desde el contenedor del backend con el .env nuevo):
    python -m scripts.rekey_settings
    python -m scripts.rekey_settings --apply
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
from dataclasses import dataclass

from sqlalchemy import text

from app.core import secret_cipher
from app.db.session import close_engine, get_engine
from app.tenancy.context import validate_schema_name


@dataclass(frozen=True)
class Target:
    """Una columna cifrada: dónde está y cómo se arma su AAD."""

    table: str
    key_column: str
    value_columns: tuple[str, ...]

    def aad(self, schema: str, key: object) -> tuple[str, str]:
        """(setting_key, namespace) con los que se cifró para esa fila."""
        if self.table == "admin_totp":
            return f"user:{key}", f"admin_totp:{schema}"
        return str(key), self.table


TARGETS = (
    Target("platform_settings", "key", ("encrypted_value",)),
    Target("app_settings", "key", ("value",)),
    Target("admin_totp", "user_id", ("secret_ciphertext", "pending_ciphertext")),
)


class RekeyError(RuntimeError):
    pass


def old_keys(environ: dict[str, str]) -> list[bytes]:
    keys = []
    explicit = environ.get("OLD_SETTINGS_ENCRYPTION_KEY", "").strip()
    if explicit:
        keys.append(secret_cipher._decode_explicit_key(explicit))
    secret = environ.get("OLD_SECRET_KEY", "")
    if secret:
        keys.append(hashlib.sha256(secret_cipher._KEY_CONTEXT + secret.encode("utf-8")).digest())
    return keys


def rekey_value(value: str, setting_key: str, namespaces: tuple[str, ...], keys: list[bytes]) -> str | None:
    """Devuelve el ciphertext nuevo, o None si no hay nada que cambiar.

    ``namespaces[0]`` es el bueno; los siguientes son los que pudo tener antes
    (el TOTP cifrado en public).

    El texto plano se deja como está. En ``app_settings`` conviven secretos y
    ajustes comunes (país por defecto, horas de cierre...), y solo el backend
    sabe cuáles son secretos: cifrarlos todos acá rompería la lectura de los
    que no lo son. Los secretos que quedaron en plano los cifra la migración
    automática del backend al arrancar.
    """
    target_namespace = namespaces[0]
    if not secret_cipher.is_encrypted(value):
        return None
    current = secret_cipher._primary_key()
    try:
        secret_cipher._decrypt_with(current, setting_key, value, target_namespace)
        return None
    except secret_cipher.SecretCipherError:
        pass
    for key in (current, *keys):
        for namespace in namespaces:
            try:
                plaintext = secret_cipher._decrypt_with(key, setting_key, value, namespace)
            except secret_cipher.SecretCipherError:
                continue
            return secret_cipher.encrypt_secret(setting_key, plaintext, namespace=target_namespace)
    raise RekeyError(f"'{setting_key}' ({target_namespace}) no abre con ninguna clave conocida")


async def _schemas(connection) -> list[str]:
    rows = (
        await connection.execute(text("SELECT schema_name FROM public.organizations ORDER BY schema_name"))
    ).scalars().all()
    return ["public", *(validate_schema_name(name) for name in rows)]


async def _has_table(connection, schema: str, table: str) -> bool:
    return bool(
        (
            await connection.execute(
                text("SELECT 1 FROM pg_tables WHERE schemaname = :s AND tablename = :t"),
                {"s": schema, "t": table},
            )
        ).first()
    )


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="sin este flag solo informa lo que haría")
    args = parser.parse_args()

    keys = old_keys(dict(os.environ))
    if not keys:
        raise SystemExit("Falta OLD_SETTINGS_ENCRYPTION_KEY u OLD_SECRET_KEY en el entorno")

    pendientes: list[tuple[str, str, str, object, str]] = []
    al_dia = 0
    try:
        async with get_engine().begin() as connection:
            preparer = connection.dialect.identifier_preparer
            for schema in await _schemas(connection):
                for target in TARGETS:
                    if target.table == "platform_settings" and schema != "public":
                        continue
                    if not await _has_table(connection, schema, target.table):
                        continue
                    qualified = f"{preparer.quote(schema)}.{preparer.quote(target.table)}"
                    columns = ", ".join(preparer.quote(c) for c in (target.key_column, *target.value_columns))
                    for row in (await connection.execute(text(f"SELECT {columns} FROM {qualified}"))).all():
                        key = row[0]
                        setting_key, namespace = target.aad(schema, key)
                        namespaces = (namespace,)
                        if target.table == "admin_totp" and schema != "public":
                            namespaces = (namespace, "admin_totp:public")
                        for column, value in zip(target.value_columns, row[1:]):
                            if not value:
                                continue
                            nuevo = rekey_value(value, setting_key, namespaces, keys)
                            if nuevo is None:
                                al_dia += 1
                                continue
                            pendientes.append((qualified, column, target.key_column, key, nuevo))
                            print(f"  {qualified}.{column} [{setting_key}]: se re-cifra")

            if args.apply:
                for qualified, column, key_column, key, nuevo in pendientes:
                    await connection.execute(
                        text(
                            f"UPDATE {qualified} SET {preparer.quote(column)} = :v "
                            f"WHERE {preparer.quote(key_column)} = :k"
                        ),
                        {"v": nuevo, "k": key},
                    )
    except RekeyError as exc:
        raise SystemExit(f"ERROR: {exc}. No se escribió nada.") from exc
    finally:
        await close_engine()

    verbo = "Re-cifrados" if args.apply else "Se re-cifrarían"
    print(f"{verbo} {len(pendientes)} valores; {al_dia} sin cambios (ya con la clave actual o en texto plano).")
    if pendientes and not args.apply:
        print("Nada se modificó: repetir con --apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
