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
# Cabecera que se baja para medir una imagen. Sobra para JPEG/PNG/WebP/GIF
# salvo con metadatos EXIF muy grandes, caso en el que se reintenta entera.
IMAGE_HEADER_BYTES = 128 * 1024
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
    object_name: str | None = None


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


def _object_name_candidates(media_url: str) -> tuple[str, ...]:
    """Devuelve las posibles claves para una URL histórica.

    Las URLs persistidas no guardan el content type. Algunos audios antiguos
    tampoco tienen extensión, por lo que inferir la categoría únicamente por
    el nombre los clasifica como ``files`` aunque estén en ``audio``. Se prueba
    primero la ruta inferida y después las demás categorías para mantener
    compatibilidad sin cambiar las URLs almacenadas en PostgreSQL.
    """
    filename = _media_filename(media_url)
    prefix = settings.minio_prefix.strip().strip("/")

    def object_name(category: str) -> str:
        relative_name = f"{category}/{filename}"
        return f"{prefix}/{relative_name}" if prefix else relative_name

    primary = _object_name_from_filename(filename)
    candidates = [primary]
    candidates.extend(object_name(category) for category in ("images", "audio", "video", "files"))
    return tuple(dict.fromkeys(candidates))


def validate_minio_config() -> None:
    endpoint = settings.minio_endpoint.strip().rstrip("/")
    if not endpoint or not settings.minio_bucket.strip():
        raise MediaStorageError("MINIO_ENDPOINT y MINIO_BUCKET son obligatorios")
    if "://" in endpoint or "/" in endpoint:
        raise MediaStorageError("MINIO_ENDPOINT debe ser host[:puerto], sin esquema ni ruta")
    if not settings.minio_access_key or not settings.minio_secret_key:
        raise MediaStorageError("MINIO_ACCESS_KEY y MINIO_SECRET_KEY son obligatorios")


def _minio_http_client():
    """Pool HTTP con timeouts explícitos para el SDK de MinIO.

    Sin esto el SDK construye su propio pool sin `timeout`, así que una
    conexión que se queda colgada no se corta nunca. Como el SDK es síncrono,
    esas llamadas viven en el threadpool de anyio (40 hilos por defecto):
    suficientes descargas colgadas y el proceso deja de atender *cualquier*
    endpoint definido con `def` en vez de `async def`.

    El timeout de lectura es por trozo recibido, no total, así que no corta
    descargas grandes legítimas — sólo las que dejaron de avanzar.
    """
    import os

    import urllib3

    ca_certs = os.environ.get("SSL_CERT_FILE")
    if not ca_certs:
        try:
            import certifi

            ca_certs = certifi.where()
        except ImportError:  # pragma: no cover - certifi llega con minio
            ca_certs = None

    return urllib3.PoolManager(
        timeout=urllib3.Timeout(
            connect=settings.minio_connect_timeout_seconds,
            read=settings.minio_read_timeout_seconds,
        ),
        maxsize=settings.minio_pool_maxsize,
        cert_reqs="CERT_REQUIRED" if settings.minio_verify_tls else "CERT_NONE",
        ca_certs=ca_certs,
        retries=urllib3.Retry(
            total=2,
            backoff_factor=0.2,
            status_forcelist=[500, 502, 503, 504],
        ),
    )


@lru_cache(maxsize=1)
def get_minio_client():
    """Crea un cliente thread-safe por proceso, tal como recomienda el SDK."""
    validate_minio_config()
    try:
        from minio import Minio
    except ImportError as exc:  # pragma: no cover - solo ocurre en una imagen incompleta
        raise MediaStorageError("Falta instalar la dependencia 'minio'") from exc

    # Con `http_client` propio el SDK ya no mira `secure` ni `cert_check` para
    # construir el pool, pero `secure` sigue decidiendo el esquema de la URL y
    # la verificación de certificado se traslada a `cert_reqs` del pool.
    return Minio(
        settings.minio_endpoint.strip().rstrip("/"),
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
        region=settings.minio_region or None,
        http_client=_minio_http_client(),
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
    for object_name in _object_name_candidates(media_url):
        try:
            result = get_minio_client().stat_object(
                settings.minio_bucket.strip(), object_name
            )
        except Exception as exc:
            if _is_not_found(exc):
                continue
            raise MediaStorageError(f"No se pudo consultar MinIO: {type(exc).__name__}") from exc
        content_type = getattr(result, "content_type", None) or "application/octet-stream"
        return MediaObjectStat(
            int(result.size),
            content_type,
            "minio",
            _metadata_sha256(getattr(result, "metadata", None)),
            object_name,
        )
    raise MediaNotFoundError(media_url)


def stat_media(media_url: str) -> MediaObjectStat:
    if storage_backend() == "local":
        return _local_stat(_local_path(media_url))
    return _minio_stat(media_url)


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


def _iter_minio(object_name: str, offset: int, length: int) -> Iterator[bytes]:
    response = None
    try:
        response = get_minio_client().get_object(
            settings.minio_bucket.strip(),
            object_name,
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
            logger.warning("Objeto %s desapareció de MinIO entre el stat y la lectura", object_name)
            raise MediaNotFoundError(object_name) from exc
        logger.exception("Fallo leyendo %s desde MinIO a mitad de la respuesta", object_name)
        raise MediaStorageError(f"No se pudo leer desde MinIO: {type(exc).__name__}") from exc
    finally:
        if response is not None:
            response.close()
            response.release_conn()


def iter_media_stat(
    info: MediaObjectStat, media_url: str, offset: int = 0, length: int | None = None
) -> Iterator[bytes]:
    """Igual que ``iter_media`` pero reutilizando un stat ya obtenido.

    Existe porque quien ya consultó el objeto no debería volver a preguntarle
    a MinIO su tamaño: es un roundtrip completo. ``video_dimensions`` hacía
    hasta 32 lecturas por rango y cada una repetía el stat.
    """
    available = max(info.size - offset, 0)
    selected_length = available if length is None else min(max(length, 0), available)
    if info.source == "local":
        return _iter_local(_local_path(media_url), offset, selected_length)
    if not info.object_name:  # pragma: no cover - estado defensivo
        raise MediaStorageError(f"MinIO no devolvió la clave del objeto: {media_url}")
    return _iter_minio(info.object_name, offset, selected_length)


def iter_media(media_url: str, offset: int = 0, length: int | None = None) -> Iterator[bytes]:
    return iter_media_stat(stat_media(media_url), media_url, offset, length)


def read_media_bytes(media_url: str) -> bytes:
    # Un solo stat: antes eran tres (este, el de iter_media y el de su
    # llamada interna), cada uno con su propia conexión.
    info = stat_media(media_url)
    return b"".join(iter_media_stat(info, media_url, 0, info.size))


def read_media_base64(media_url: str) -> str:
    """Devuelve el archivo en base64 listo para Evolution API."""
    return base64.b64encode(read_media_bytes(media_url)).decode("ascii")


class VideoCompressionError(RuntimeError):
    pass


def compress_video(data: bytes) -> bytes:
    """Recomprime un video con ffmpeg para que entre en el límite de tamaño,
    como hace WhatsApp: H.264, lado máximo 1280px, CRF 28, audio AAC 128k y
    faststart (MP4). Devuelve los bytes del MP4.

    Lanza VideoCompressionError si ffmpeg no está disponible o falla; el llamador
    decide qué hacer (típicamente, dejar que el archivo original caiga en el
    límite de tamaño)."""
    import os
    import shutil
    import subprocess
    import tempfile

    if shutil.which("ffmpeg") is None:
        raise VideoCompressionError("ffmpeg no está disponible")

    in_path = out_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".src", delete=False) as fin:
            fin.write(data)
            in_path = fin.name
        out_path = in_path + ".mp4"
        try:
            result = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", in_path,
                    # Encaja el video en un cuadro de 1280px conservando la
                    # proporción (sirve horizontal y vertical) y fuerza dimensiones
                    # pares (libx264 las exige).
                    "-vf",
                    "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease,"
                    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
                    "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart",
                    out_path,
                ],
                capture_output=True,
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            raise VideoCompressionError("ffmpeg tardó demasiado")
        if result.returncode != 0 or not os.path.exists(out_path):
            raise VideoCompressionError(result.stderr.decode("utf-8", "replace")[-500:])
        with open(out_path, "rb") as handle:
            return handle.read()
    finally:
        for path in (in_path, out_path):
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass


def image_to_sticker_webp(data: bytes, size: int = 512) -> str:
    """Convierte una imagen a un sticker de WhatsApp: WEBP cuadrado de 512×512
    con fondo transparente, la imagen centrada conservando su proporción.
    Devuelve el base64 listo para el endpoint sendSticker de Evolution."""
    from PIL import Image

    with Image.open(BytesIO(data)) as img:
        img = img.convert("RGBA")
        img.thumbnail((size, size))
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
        buffer = BytesIO()
        canvas.save(buffer, format="WEBP")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def image_dimensions(media_url: str) -> tuple[int, int] | None:
    """Ancho/alto de una imagen almacenada, o None si no se pudo medir.

    PIL necesita muy pocos bytes para esto, pero antes se le pasaba el archivo
    entero: medir una foto de 4 MB descargaba los 4 MB. Ahora se intenta con
    una cabecera por rango y solo se baja el resto si esa cabecera no alcanzó
    (por ejemplo un JPEG con EXIF grande antes del marcador SOF).
    """
    from PIL import Image

    try:
        info = stat_media(media_url)
    except (MediaNotFoundError, MediaStorageError):
        return None

    attempts = [size for size in (IMAGE_HEADER_BYTES, info.size) if size < info.size]
    attempts.append(info.size)

    for length in attempts:
        try:
            data = b"".join(iter_media_stat(info, media_url, 0, length))
            with Image.open(BytesIO(data)) as img:
                return img.width, img.height
        except Exception:
            continue
    return None


def _mp4_boxes(data: bytes, start: int, end: int):
    """Itera los boxes ISO BMFF de un rango: (tipo, inicio_payload, fin)."""
    pos = start
    while pos + 8 <= end:
        size = int.from_bytes(data[pos:pos + 4], "big")
        box_type = data[pos + 4:pos + 8]
        header = 8
        if size == 1:
            if pos + 16 > end:
                return
            size = int.from_bytes(data[pos + 8:pos + 16], "big")
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            return
        yield box_type, pos + header, pos + size
        pos += size


def _mp4_dimensions(data: bytes) -> tuple[int, int] | None:
    """Dimensiones de presentación de un MP4/MOV vía moov > trak > tkhd.

    Los videos de teléfono en portrait suelen venir con los frames en
    landscape más una matriz de rotación en tkhd: si la matriz rota 90/270
    (a y d en 0), el ancho/alto se intercambian para reflejar cómo se ve."""
    for _, moov_s, moov_e in (b for b in _mp4_boxes(data, 0, len(data)) if b[0] == b"moov"):
        for _, trak_s, trak_e in (b for b in _mp4_boxes(data, moov_s, moov_e) if b[0] == b"trak"):
            for _, tk_s, tk_e in (b for b in _mp4_boxes(data, trak_s, trak_e) if b[0] == b"tkhd"):
                version = data[tk_s]
                # payload: version+flags(4) + campos v0(20)/v1(32), luego
                # reserved(8)+layer(2)+alt(2)+volume(2)+reserved(2) = 16
                matrix_off = tk_s + (36 if version == 1 else 24) + 16
                width_off = matrix_off + 36
                if width_off + 8 > tk_e:
                    continue
                width = int.from_bytes(data[width_off:width_off + 4], "big") >> 16
                height = int.from_bytes(data[width_off + 4:width_off + 8], "big") >> 16
                if not width or not height:
                    continue  # pista de audio u otra sin video
                a = int.from_bytes(data[matrix_off:matrix_off + 4], "big", signed=True)
                d = int.from_bytes(data[matrix_off + 16:matrix_off + 20], "big", signed=True)
                if a == 0 and d == 0:
                    width, height = height, width
                return width, height
    return None


def video_dimensions(media_url: str) -> tuple[int, int] | None:
    """Ancho/alto de presentación de un video almacenado (MP4/MOV), o None.

    No descarga el archivo entero: recorre los headers de los boxes de primer
    nivel con lecturas por rango (saltando mdat, que es el video en sí) y
    solo baja el box moov, que pesa unos pocos KB."""
    try:
        # Un único stat para todo el recorrido: antes cada read_range volvía a
        # consultar el objeto, hasta 32 veces por archivo.
        info = stat_media(media_url)
    except (MediaNotFoundError, MediaStorageError):
        return None

    def read_range(offset: int, length: int) -> bytes:
        return b"".join(iter_media_stat(info, media_url, offset, length))

    try:
        size = info.size
        pos = 0
        for _ in range(32):  # un MP4 tiene un puñado de boxes de primer nivel
            if pos + 8 > size:
                return None
            header = read_range(pos, 16)
            if len(header) < 8:
                return None
            box_size = int.from_bytes(header[0:4], "big")
            box_type = header[4:8]
            if box_size == 1 and len(header) >= 16:
                box_size = int.from_bytes(header[8:16], "big")
            elif box_size == 0:
                box_size = size - pos
            if box_size < 8:
                return None
            if box_type == b"moov":
                return _mp4_dimensions(read_range(pos, min(box_size, 8 * 1024 * 1024)))
            pos += box_size
        return None
    except Exception:
        return None


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

    return media_url


def delete_media(media_url: str) -> None:
    if storage_backend() == "local":
        _local_path(media_url).unlink(missing_ok=True)
        return

    try:
        info = _minio_stat(media_url)
        if info.object_name:
            get_minio_client().remove_object(settings.minio_bucket.strip(), info.object_name)
    except MediaNotFoundError:
        pass
    except Exception as exc:
        raise MediaStorageError(f"No se pudo eliminar de MinIO: {type(exc).__name__}") from exc


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
    validate_minio_config()
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
