import asyncio
import base64
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.media_storage import (
    MediaNotFoundError,
    MediaStorageError,
    iter_media,
    save_media_bytes,
    stat_media,
)
from services.settings_service import get_effective

router = APIRouter(prefix="/api/media", tags=["media"])
files_router = APIRouter(tags=["media-files"])

ALLOWED_CONTENT_PREFIXES = ("image/", "video/", "audio/")
# Documentos: se enumeran explícito en vez de aceptar cualquier content_type,
# para no convertir esto en un upload de archivos arbitrario (ej. .html/.svg
# servidos luego desde /media/ podrían ser un vector de XSS).
ALLOWED_DOCUMENT_TYPES = (
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "application/zip",
)
MAX_BYTES = 25 * 1024 * 1024  # 25 MB
SAFE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov",
    ".mp3", ".wav", ".ogg", ".m4a", ".weba", ".pdf", ".doc", ".docx", ".xls",
    ".xlsx", ".ppt", ".pptx", ".txt", ".zip",
}
EXTENSION_CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
    ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg",
    ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".weba": "audio/webm",
    ".pdf": "application/pdf", ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain", ".zip": "application/zip",
}

# ``mimetypes`` depende de la base de tipos de la imagen del sistema. Alpine
# no siempre conoce audio/webm, lo que antes dejaba las notas de voz sin
# extensión y hacía imposible inferir su categoría al leerlas después.
CONTENT_TYPE_EXTENSIONS = {
    "audio/webm": ".weba",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
}


class MediaUpload(BaseModel):
    content_type: str
    data_base64: str


def normalize_media_content_type(content_type: str, filename: str | None = None) -> str:
    normalized = content_type.split(";", 1)[0].strip().lower()
    if normalized.startswith(ALLOWED_CONTENT_PREFIXES) or normalized in ALLOWED_DOCUMENT_TYPES:
        return normalized
    if filename:
        suffix = Path(filename).suffix.lower()
        if suffix in EXTENSION_CONTENT_TYPES:
            return EXTENSION_CONTENT_TYPES[suffix]
    return normalized


def save_media_file(content_type: str, data_base64: str, filename: str | None = None) -> str:
    """Decodifica y guarda un archivo base64, y devuelve su media_url estable.
    Lanza ValueError con el motivo si el archivo no es válido.

    La extensión se toma del filename original cuando está disponible, en vez
    de adivinarla con mimetypes.guess_extension(content_type): en la imagen
    Linux del backend, ese mapeo no conoce los tipos Office Open XML (.docx,
    .xlsx, .pptx) y devuelve None — el archivo terminaba guardado sin
    extensión, y como esos formatos son en el fondo un ZIP, el navegador lo
    servía/interpretaba como tal en vez de como el documento real."""
    content_type = normalize_media_content_type(content_type, filename)
    if not (content_type.startswith(ALLOWED_CONTENT_PREFIXES) or content_type in ALLOWED_DOCUMENT_TYPES):
        raise ValueError("Tipo de archivo no permitido")

    try:
        raw = base64.b64decode(data_base64, validate=True)
    except Exception:
        raise ValueError("base64 inválido")

    if not raw:
        raise ValueError("El archivo está vacío")
    if len(raw) > MAX_BYTES:
        raise ValueError("Archivo demasiado grande")

    ext = ""
    if filename and "." in filename:
        candidate = "." + filename.rsplit(".", 1)[-1].lower()
        if candidate in SAFE_EXTENSIONS:
            ext = candidate
    if not ext:
        ext = CONTENT_TYPE_EXTENSIONS.get(content_type) or mimetypes.guess_extension(content_type) or ""

    stored_filename = f"{uuid.uuid4().hex}{ext}"
    return save_media_bytes(stored_filename, raw, content_type)


def _requested_range(value: str | None, size: int) -> tuple[int, int, int]:
    """Devuelve (inicio, longitud, status) para un único rango HTTP."""
    if not value:
        return 0, size, 200
    try:
        unit, selection = value.split("=", 1)
        if unit.strip().lower() != "bytes" or "," in selection:
            raise ValueError
        start_text, end_text = selection.strip().split("-", 1)
        if not start_text:
            suffix = int(end_text)
            if suffix <= 0:
                raise ValueError
            start = max(size - suffix, 0)
            end = size - 1
        else:
            start = int(start_text)
            end = min(int(end_text), size - 1) if end_text else size - 1
            if start < 0 or start >= size or end < start:
                raise ValueError
    except (ValueError, TypeError):
        raise HTTPException(416, "Rango no válido", headers={"Content-Range": f"bytes */{size}"})
    return start, end - start + 1, 206


@files_router.api_route("/media/{filename}", methods=["GET", "HEAD"])
def get_media_file(filename: str, request: Request, range_header: str | None = Header(default=None, alias="Range")):
    """Entrega archivos locales o privados de MinIO conservando URLs históricas."""
    media_url = f"/media/{filename}"
    try:
        info = stat_media(media_url)
    except MediaNotFoundError:
        raise HTTPException(404, "Archivo no encontrado")
    except MediaStorageError as exc:
        raise HTTPException(503, str(exc))

    start, length, status_code = _requested_range(range_header, info.size)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{start + length - 1}/{info.size}"
    if request.method == "HEAD":
        return Response(status_code=status_code, headers=headers, media_type=info.content_type)
    return StreamingResponse(
        iter_media(media_url, start, length),
        status_code=status_code,
        headers=headers,
        media_type=info.content_type,
    )


@router.post("/upload")
async def upload_media(
    body: MediaUpload, x_webhook_token: str | None = Header(default=None)
):
    """Llamado por n8n con el base64 del archivo (imagen/video/audio) justo después de descargarlo de Evolution API."""
    expected_token = await get_effective("inbound_webhook_token")
    if expected_token and x_webhook_token != expected_token:
        raise HTTPException(status_code=401, detail="Token inválido")

    try:
        media_url = await asyncio.to_thread(save_media_file, body.content_type, body.data_base64)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    except MediaStorageError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return {"media_url": media_url}
