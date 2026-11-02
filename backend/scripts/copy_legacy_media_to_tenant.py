"""Copia los archivos multimedia de la instalación single-tenant al tenant.

Acompaña a ``scripts.move_public_to_tenant``. Sin multitenancy, los objetos se
guardan en ``<MINIO_PREFIX>/<categoría>/<archivo>``; con multitenancy, el
backend los busca en ``<MINIO_PREFIX>/tenants/<carpeta del negocio>/...`` y
no mira la ruta vieja. Las URLs en PostgreSQL (``/media/<archivo>``) no
cambian: lo único que hay que mover son los objetos.

Copia en vez de mover: los originales quedan donde estaban, así que volver al
binario single-tenant sigue sirviendo todo. Es idempotente: un objeto que ya
está en el destino con el mismo tamaño se salta, de modo que se puede correr
antes del corte (para adelantar el grueso) y otra vez con las escrituras
paradas (para lo que llegó mientras tanto).

Uso:
    python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.localhost
    python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.localhost --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json

from app.core.config import settings
from app.db.session import close_engine
from app.integrations.storage import media_storage
from app.tenancy.context import tenant_context
from app.tenancy.resolver import normalize_hostname, resolve_tenant_by_hostname


def destination_for(object_name: str, legacy_prefix: str, tenant_prefix: str) -> str | None:
    """Clave del objeto dentro del tenant, o None si no es un objeto legacy.

    Lo que ya está bajo ``tenants/`` es de algún negocio y no se toca.
    """
    legacy_root = f"{legacy_prefix}/" if legacy_prefix else ""
    if not object_name.startswith(legacy_root):
        return None
    relative = object_name[len(legacy_root):]
    if not relative or relative.startswith("tenants/"):
        return None
    return f"{tenant_prefix}/{relative}"


def _size_or_none(client, bucket: str, object_name: str) -> int | None:
    try:
        return client.stat_object(bucket, object_name).size
    except Exception as exc:
        if media_storage._is_not_found(exc):
            return None
        raise


def copy_legacy_media(client, bucket: str, legacy_prefix: str, tenant_prefix: str, apply: bool) -> dict:
    from minio.commonconfig import CopySource

    resumen = {"copiados": 0, "por_copiar": 0, "ya_estaban": 0, "bytes": 0, "conflictos": []}
    listing_prefix = f"{legacy_prefix}/" if legacy_prefix else None
    for item in client.list_objects(bucket, prefix=listing_prefix, recursive=True):
        destination = destination_for(item.object_name, legacy_prefix, tenant_prefix)
        if destination is None:
            continue
        existing = _size_or_none(client, bucket, destination)
        if existing == item.size:
            resumen["ya_estaban"] += 1
            continue
        if existing is not None:
            # Mismo nombre y otro contenido: lo escribió el negocio ya con
            # multitenancy. Pisarlo perdería ese archivo; se informa y se sigue.
            resumen["conflictos"].append(destination)
            continue
        resumen["bytes"] += item.size
        if not apply:
            resumen["por_copiar"] += 1
            continue
        # La copia conserva content type y metadatos (sha256 incluido).
        client.copy_object(bucket, destination, CopySource(bucket, item.object_name))
        if _size_or_none(client, bucket, destination) != item.size:
            raise media_storage.MediaStorageError(f"Falló la verificación de {destination}")
        resumen["copiados"] += 1
    return resumen


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="sin este flag solo informa lo que haría",
    )
    args = parser.parse_args()

    try:
        if media_storage.storage_backend() != "minio":
            raise SystemExit("MEDIA_STORAGE_BACKEND no es minio: no hay objetos que copiar")
        context = await resolve_tenant_by_hostname(normalize_hostname(args.hostname))
        if context is None:
            raise SystemExit(f"No hay ninguna organización activa para {args.hostname}")

        # Sin contexto de tenant, el prefijo es el de la instalación legacy;
        # con contexto, el del negocio. Se calculan con la misma función que
        # usa el backend para no reimplementar la ruta y desalinearse de ella.
        legacy_prefix = media_storage._object_prefix()
        with tenant_context(context):
            tenant_prefix = media_storage._object_prefix()

        resumen = copy_legacy_media(
            media_storage.get_minio_client(),
            settings.minio_bucket.strip(),
            legacy_prefix,
            tenant_prefix,
            args.apply,
        )
        print(json.dumps({"origen": legacy_prefix or "(raíz)", "destino": tenant_prefix, **resumen}, ensure_ascii=False, indent=2))
        if not args.apply:
            print("Nada se modificó: repetir con --apply.")
        return 1 if resumen["conflictos"] else 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
