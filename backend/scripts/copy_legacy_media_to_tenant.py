"""Copia los archivos multimedia de la instalación single-tenant al tenant.

Acompaña a ``scripts.move_public_to_tenant``. Sin multitenancy, los objetos se
guardan en ``<MINIO_PREFIX>/<categoría>/<archivo>``; con multitenancy, el
backend los busca en ``<MINIO_PREFIX>/tenants/<carpeta del negocio>/...`` y
no mira la ruta vieja. Las URLs en PostgreSQL (``/media/<archivo>``) no
cambian: lo único que hay que mover son los objetos.

El destino es siempre el bucket y el prefijo del .env con el que corre (el
nuevo). El origen, si es otro bucket u otro prefijo, se indica con
``--source-bucket`` y ``--source-prefix``. Dos formas de copiar:

- Misma credencial (la del .env) con lectura sobre el bucket de origen: la
  copia la hace MinIO por dentro, sin que los bytes pasen por este servidor.
- Credencial distinta para el origen, en ``SOURCE_MINIO_ACCESS_KEY`` y
  ``SOURCE_MINIO_SECRET_KEY`` (y ``SOURCE_MINIO_ENDPOINT`` si es otro
  servidor): se descarga con una y se sube con la otra, en streaming.

Copia en vez de mover: los originales quedan donde estaban, así que volver a
la instalación anterior sigue sirviendo todo. Es idempotente: un objeto que ya
está en el destino con el mismo tamaño se salta, de modo que se puede correr
antes del corte (para adelantar el grueso) y otra vez con las escrituras
paradas (para lo que llegó mientras tanto).

Uso:
    python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.localhost
    python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.localhost \
        --source-bucket wsp --source-prefix media --workers 8 --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings
from app.db.session import close_engine
from app.integrations.storage import media_storage
from app.tenancy.context import tenant_context
from app.tenancy.resolver import normalize_hostname, resolve_tenant_by_hostname

PROGRESS_EVERY = 500


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


def _user_metadata(stat) -> dict[str, str]:
    # stat_object devuelve las cabeceras crudas; put_object las quiere sin el
    # prefijo, que vuelve a poner él.
    prefix = "x-amz-meta-"
    return {
        name[len(prefix):]: value
        for name, value in (stat.metadata or {}).items()
        if name.lower().startswith(prefix)
    }


def _copy_one(source, source_bucket, dest, dest_bucket, object_name, destination, size) -> None:
    if source is dest:
        from minio.commonconfig import CopySource

        # La copia conserva content type y metadatos (sha256 incluido).
        dest.copy_object(dest_bucket, destination, CopySource(source_bucket, object_name))
    else:
        stat = source.stat_object(source_bucket, object_name)
        response = source.get_object(source_bucket, object_name)
        try:
            dest.put_object(
                dest_bucket,
                destination,
                response,
                length=size,
                content_type=stat.content_type or "application/octet-stream",
                metadata=_user_metadata(stat),
            )
        finally:
            response.close()
            response.release_conn()
    if _size_or_none(dest, dest_bucket, destination) != size:
        raise media_storage.MediaStorageError(f"Falló la verificación de {destination}")


def copy_legacy_media(
    source,
    source_bucket: str,
    legacy_prefix: str,
    dest,
    dest_bucket: str,
    tenant_prefix: str,
    apply: bool,
    workers: int = 1,
) -> dict:
    resumen = {"copiados": 0, "por_copiar": 0, "ya_estaban": 0, "bytes": 0, "conflictos": [], "errores": []}
    lock = threading.Lock()
    vistos = 0

    def procesar(item) -> None:
        nonlocal vistos
        destination = destination_for(item.object_name, legacy_prefix, tenant_prefix)
        if destination is None:
            return
        try:
            existing = _size_or_none(dest, dest_bucket, destination)
            if existing == item.size:
                estado = "ya_estaban"
            elif existing is not None:
                # Mismo nombre y otro contenido: lo escribió el negocio ya con
                # multitenancy. Pisarlo perdería ese archivo.
                estado = "conflicto"
            elif not apply:
                estado = "por_copiar"
            else:
                _copy_one(source, source_bucket, dest, dest_bucket, item.object_name, destination, item.size)
                estado = "copiados"
        except Exception as exc:
            with lock:
                resumen["errores"].append(f"{item.object_name}: {type(exc).__name__}: {exc}")
            return
        with lock:
            if estado == "conflicto":
                resumen["conflictos"].append(destination)
            else:
                resumen[estado] += 1
                if estado in {"copiados", "por_copiar"}:
                    resumen["bytes"] += item.size
            vistos += 1
            if vistos % PROGRESS_EVERY == 0:
                print(
                    f"  {vistos} revisados, {resumen['copiados']} copiados, "
                    f"{resumen['bytes'] / 1e9:.1f} GB",
                    file=sys.stderr,
                    flush=True,
                )

    listing_prefix = f"{legacy_prefix}/" if legacy_prefix else None
    items = source.list_objects(source_bucket, prefix=listing_prefix, recursive=True)
    if workers <= 1:
        for item in items:
            procesar(item)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            # El `with` espera a que terminen todas; los errores de cada objeto
            # ya quedan en el resumen dentro de procesar().
            for item in items:
                pool.submit(procesar, item)
    return resumen


def _source_client(dest):
    access = os.environ.get("SOURCE_MINIO_ACCESS_KEY", "").strip()
    secret = os.environ.get("SOURCE_MINIO_SECRET_KEY", "").strip()
    if not access and not secret:
        return dest
    if not access or not secret:
        raise SystemExit("Faltan SOURCE_MINIO_ACCESS_KEY y SOURCE_MINIO_SECRET_KEY juntas")
    from minio import Minio

    return Minio(
        os.environ.get("SOURCE_MINIO_ENDPOINT", "").strip() or settings.minio_endpoint.strip().rstrip("/"),
        access_key=access,
        secret_key=secret,
        secure=settings.minio_secure,
        region=settings.minio_region or None,
        http_client=media_storage._minio_http_client(),
    )


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--source-bucket", help="por defecto, el MINIO_BUCKET del .env")
    parser.add_argument("--source-prefix", help="por defecto, el MINIO_PREFIX del .env")
    parser.add_argument("--workers", type=int, default=4, help="copias en paralelo (por defecto 4)")
    parser.add_argument("--apply", action="store_true", help="sin este flag solo informa lo que haría")
    args = parser.parse_args()

    try:
        if media_storage.storage_backend() != "minio":
            raise SystemExit("MEDIA_STORAGE_BACKEND no es minio: no hay objetos que copiar")
        context = await resolve_tenant_by_hostname(normalize_hostname(args.hostname))
        if context is None:
            raise SystemExit(f"No hay ninguna organización activa para {args.hostname}")

        dest_bucket = settings.minio_bucket.strip()
        source_bucket = (args.source_bucket or dest_bucket).strip()
        # Sin contexto de tenant, el prefijo es el de la instalación legacy;
        # con contexto, el del negocio. Se calculan con la misma función que
        # usa el backend para no reimplementar la ruta y desalinearse de ella.
        if args.source_prefix is None:
            legacy_prefix = media_storage._object_prefix()
        else:
            legacy_prefix = args.source_prefix.strip().strip("/")
        with tenant_context(context):
            tenant_prefix = media_storage._object_prefix()
        if source_bucket == dest_bucket and legacy_prefix == tenant_prefix:
            raise SystemExit("Origen y destino son la misma ruta: nada que copiar")

        dest = media_storage.get_minio_client()
        source = _source_client(dest)
        resumen = copy_legacy_media(
            source, source_bucket, legacy_prefix,
            dest, dest_bucket, tenant_prefix,
            args.apply, workers=max(1, args.workers),
        )
        modo = "copia interna de MinIO" if source is dest else "descarga y subida (credenciales distintas)"
        print(json.dumps(
            {
                "origen": f"{source_bucket}/{legacy_prefix or '(raíz)'}",
                "destino": f"{dest_bucket}/{tenant_prefix}",
                "modo": modo,
                **{k: v for k, v in resumen.items() if k not in {"conflictos", "errores"}},
                "conflictos": len(resumen["conflictos"]),
                "errores": len(resumen["errores"]),
            },
            ensure_ascii=False,
            indent=2,
        ))
        for linea in (resumen["conflictos"] + resumen["errores"])[:20]:
            print(f"  ! {linea}")
        if not args.apply:
            print("Nada se modificó: repetir con --apply.")
        return 1 if resumen["conflictos"] or resumen["errores"] else 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
