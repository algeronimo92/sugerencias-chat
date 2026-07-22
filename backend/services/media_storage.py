"""Almacenamiento multimedia intercambiable entre disco local y MinIO.

Las URLs persistidas siguen teniendo la forma ``/media/<archivo>``. El nombre
se traduce a un objeto dentro de ``MINIO_PREFIX`` cuando MinIO es el backend
primario, de modo que la migración no exige modificar PostgreSQL ni el
frontend.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import mimetypes
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlsplit

from config import settings

logger = logging.getLogger(__name__)

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)
CHUNK_SIZE = 64 * 1024
NOT_FOUND_CODES = {"NoSuchKey", "NoSuchObject", "NoSuchBucket", "XMinioInvalidObjectName"}


class MediaStorageError(RuntimeError):
    """Error de configuración o comunicación con el almacenamiento."""


class MediaNotFoundError(FileNotFoundError):
    """El objeto solicitado no existe en el backend configurado."""


@dataclass(frozen=True)
class MediaObjectStat:
    size: int
    content_type: str
    source: str
    sha256: str | None = None


def storage_backend() -> str:
    backend = settings.media_storage_backend.strip().lower()
    if backend not in {"local", "minio"}:
        raise MediaStorageError("MEDIA_STORAGE_BACKEND debe ser 'local' o 'minio'")
    return backend


def _media_filename(media_url: str) -> str:
    path = unquote(urlsplit(media_url).path)
    prefix = "/media/"
    if not path.startswith(prefix):
        raise MediaStorageError(f"URL multimedia inválida: {media_url}")
    filename = path[len(prefix):]
    if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
        raise MediaStorageError(f"Nombre multimedia inválido: {media_url}")
    return filename


def _local_path_from_filename(filename: str) -> Path:
    path = (MEDIA_DIR / filename).resolve()
    if path.parent != MEDIA_DIR.resolve():
        raise MediaStorageError(f"Nombre multimedia inválido: {filename}")
    return path


def _local_path(media_url: str) -> Path:
    return _local_path_from_filename(_media_filename(media_url))


def _media_category(filename: str, content_type: str | None = None) -> str:
    normalized = (content_type or mimetypes.guess_type(filename)[0] or "").lower()
    if normalized.startswith("image/"):
        return "images"
    if normalized.startswith("audio/"):
        return "audio"
    if normalized.startswith("video/"):
        return "video"
    return "files"


def _object_name_from_filename(filename: str, content_type: str | None = None) -> str:
    prefix = settings.minio_prefix.strip().strip("/")
    relative_name = f"{_media_category(filename, content_type)}/{filename}"
    return f"{prefix}/{relative_name}" if prefix else relative_name


def _object_name(media_url: str) -> str:
    return _object_name_from_filename(_media_filename(media_url))


def _validate_minio_config() -> None:
    endpoint = settings.minio_endpoint.strip().rstrip("/")
    if not endpoint or not settings.minio_bucket.strip():
        raise MediaStorageError("MINIO_ENDPOINT y MINIO_BUCKET son obligatorios")
    if "://" in endpoint or "/" in endpoint:
        raise MediaStorageError("MINIO_ENDPOINT debe ser host[:puerto], sin esquema ni ruta")
    if not settings.minio_access_key or not settings.minio_secret_key:
        raise MediaStorageError("MINIO_ACCESS_KEY y MINIO_SECRET_KEY son obligatorios")


@lru_cache(maxsize=1)
def get_minio_client():
    """Crea un cliente thread-safe por proceso, tal como recomienda el SDK."""
    _validate_minio_config()
    try:
        from minio import Minio
    except ImportError as exc:  # pragma: no cover - solo ocurre en una imagen incompleta
        raise MediaStorageError("Falta instalar la dependencia 'minio'") from exc

    return Minio(
        settings.minio_endpoint.strip().rstrip("/"),
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
        region=settings.minio_region or None,
        cert_check=settings.minio_verify_tls,
    )


def _is_not_found(exc: Exception) -> bool:
    return getattr(exc, "code", None) in NOT_FOUND_CODES


def _local_stat(path: Path) -> MediaObjectStat:
    if not path.is_file():
        raise MediaNotFoundError(str(path))
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return MediaObjectStat(path.stat().st_size, content_type, "local")


def _metadata_sha256(metadata: dict | None) -> str | None:
    if not metadata:
        return None
    normalized = {str(key).lower(): str(value) for key, value in metadata.items()}
    return normalized.get("x-amz-meta-sha256") or normalized.get("sha256")


def _minio_stat(media_url: str) -> MediaObjectStat:
    try:
        result = get_minio_client().stat_object(
            settings.minio_bucket.strip(), _object_name(media_url)
        )
    except Exception as exc:
        if _is_not_found(exc):
            raise MediaNotFoundError(media_url) from exc
        raise MediaStorageError(f"No se pudo consultar MinIO: {type(exc).__name__}") from exc
    content_type = getattr(result, "content_type", None) or "application/octet-stream"
    return MediaObjectStat(
        int(result.size), content_type, "minio", _metadata_sha256(getattr(result, "metadata", None))
    )


def stat_media(media_url: str) -> MediaObjectStat:
    if storage_backend() == "local":
        return _local_stat(_local_path(media_url))

    try:
        return _minio_stat(media_url)
    except (MediaNotFoundError, MediaStorageError):
        local_path = _local_path(media_url)
        if settings.media_local_read_fallback and local_path.is_file():
            logger.warning("Usando fallback local para %s", media_url)
            return _local_stat(local_path)
        raise


def media_size(media_url: str) -> int:
    return stat_media(media_url).size


def _iter_local(path: Path, offset: int, length: int) -> Iterator[bytes]:
    remaining = length
    with path.open("rb") as handle:
        handle.seek(offset)
        while remaining > 0:
            chunk = handle.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _iter_minio(media_url: str, offset: int, length: int) -> Iterator[bytes]:
    response = None
    try:
        response = get_minio_client().get_object(
            settings.minio_bucket.strip(),
            _object_name(media_url),
            offset=offset,
            length=length,
        )
        remaining = length
        while remaining > 0:
            chunk = response.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    except Exception as exc:
        if _is_not_found(exc):
            raise MediaNotFoundError(media_url) from exc
        raise MediaStorageError(f"No se pudo leer desde MinIO: {type(exc).__name__}") from exc
    finally:
        if response is not None:
            response.close()
            response.release_conn()


def iter_media(media_url: str, offset: int = 0, length: int | None = None) -> Iterator[bytes]:
    info = stat_media(media_url)
    available = max(info.size - offset, 0)
    selected_length = available if length is None else min(max(length, 0), available)
    if info.source == "local":
        return _iter_local(_local_path(media_url), offset, selected_length)
    return _iter_minio(media_url, offset, selected_length)


def read_media_bytes(media_url: str) -> bytes:
    info = stat_media(media_url)
    return b"".join(iter_media(media_url, 0, info.size))


def read_media_base64(media_url: str) -> str:
    """Devuelve el archivo en base64 listo para Evolution API."""
    return base64.b64encode(read_media_bytes(media_url)).decode("ascii")


def _write_local(filename: str, data: bytes) -> None:
    _local_path_from_filename(filename).write_bytes(data)


def save_media_bytes(filename: str, data: bytes, content_type: str) -> str:
    """Guarda bytes y devuelve la URL estable que se persiste en PostgreSQL."""
    _local_path_from_filename(filename)  # valida el nombre incluso usando MinIO
    media_url = f"/media/{filename}"
    if storage_backend() == "local":
        _write_local(filename, data)
        return media_url

    digest = hashlib.sha256(data).hexdigest()
    try:
        get_minio_client().put_object(
            settings.minio_bucket.strip(),
            _object_name_from_filename(filename, content_type),
            BytesIO(data),
            len(data),
            content_type=content_type,
            metadata={"sha256": digest},
        )
    except Exception as exc:
        raise MediaStorageError(f"No se pudo guardar en MinIO: {type(exc).__name__}") from exc

    if settings.media_dual_write_local:
        try:
            _write_local(filename, data)
        except OSError:
            logger.exception("MinIO guardó %s, pero falló la copia local de transición", media_url)
    return media_url


def delete_media(media_url: str) -> None:
    local_path = _local_path(media_url)
    if storage_backend() == "local":
        local_path.unlink(missing_ok=True)
        return

    try:
        get_minio_client().remove_object(settings.minio_bucket.strip(), _object_name(media_url))
    except Exception as exc:
        raise MediaStorageError(f"No se pudo eliminar de MinIO: {type(exc).__name__}") from exc
    if settings.media_dual_write_local or settings.media_local_read_fallback:
        local_path.unlink(missing_ok=True)


def check_media_storage() -> dict[str, str]:
    """Valida configuración y acceso al bucket sin crear recursos."""
    backend = storage_backend()
    if backend == "local":
        if not MEDIA_DIR.is_dir():
            raise MediaStorageError("El directorio multimedia local no existe")
        return {"backend": "local", "status": "ok"}

    try:
        exists = get_minio_client().bucket_exists(settings.minio_bucket.strip())
    except Exception as exc:
        raise MediaStorageError(f"MinIO no está disponible: {type(exc).__name__}") from exc
    if not exists:
        raise MediaStorageError(f"El bucket MinIO '{settings.minio_bucket}' no existe")
    return {"backend": "minio", "status": "ok"}


def upload_local_file_to_minio(path: Path, content_type: str, overwrite: bool = False) -> str:
    """Sube un archivo local conservando su nombre; usado por el migrador."""
    if not path.is_file() or path.parent.resolve() != MEDIA_DIR.resolve():
        raise MediaStorageError(f"Archivo local inválido: {path}")
    _validate_minio_config()
    media_url = f"/media/{path.name}"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()

    try:
        existing = _minio_stat(media_url)
    except MediaNotFoundError:
        existing = None

    if existing is not None:
        if existing.size == path.stat().st_size and existing.sha256 == digest:
            return "verified"
        if existing.size == path.stat().st_size and existing.sha256 is None and not overwrite:
            return "same-size"
        if not overwrite:
            raise MediaStorageError(f"El objeto ya existe con contenido diferente: {media_url}")

    try:
        get_minio_client().fput_object(
            settings.minio_bucket.strip(),
            _object_name_from_filename(path.name, content_type),
            str(path),
            content_type=content_type or "application/octet-stream",
            metadata={"sha256": digest},
        )
    except Exception as exc:
        raise MediaStorageError(f"No se pudo migrar {path.name}: {type(exc).__name__}") from exc

    verified = _minio_stat(media_url)
    if verified.size != path.stat().st_size or verified.sha256 != digest:
        raise MediaStorageError(f"Falló la verificación de {path.name}")
    return "uploaded"
