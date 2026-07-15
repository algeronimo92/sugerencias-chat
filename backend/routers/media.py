import base64
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from services.settings_service import get_effective

router = APIRouter(prefix="/api/media", tags=["media"])

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)

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
    ".mp3", ".wav", ".ogg", ".m4a", ".pdf", ".doc", ".docx", ".xls",
    ".xlsx", ".ppt", ".pptx", ".txt", ".zip",
}
EXTENSION_CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4",
    ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg",
    ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".pdf": "application/pdf", ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain", ".zip": "application/zip",
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
    """Decodifica y guarda un archivo base64 en MEDIA_DIR, devuelve su media_url.
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

    if len(raw) > MAX_BYTES:
        raise ValueError("Archivo demasiado grande")

    ext = ""
    if filename and "." in filename:
        candidate = "." + filename.rsplit(".", 1)[-1].lower()
        if candidate in SAFE_EXTENSIONS:
            ext = candidate
    if not ext:
        ext = mimetypes.guess_extension(content_type) or ""

    stored_filename = f"{uuid.uuid4().hex}{ext}"
    (MEDIA_DIR / stored_filename).write_bytes(raw)

    return f"/media/{stored_filename}"


@router.post("/upload")
async def upload_media(
    body: MediaUpload, x_webhook_token: str | None = Header(default=None)
):
    """Llamado por n8n con el base64 del archivo (imagen/video/audio) justo después de descargarlo de Evolution API."""
    expected_token = await get_effective("inbound_webhook_token")
    if expected_token and x_webhook_token != expected_token:
        raise HTTPException(status_code=401, detail="Token inválido")

    try:
        media_url = save_media_file(body.content_type, body.data_base64)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))

    return {"media_url": media_url}
