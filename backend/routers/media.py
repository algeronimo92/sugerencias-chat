import base64
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from config import settings

router = APIRouter(prefix="/api/media", tags=["media"])

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)

ALLOWED_CONTENT_PREFIXES = ("image/", "video/", "audio/")
MAX_BYTES = 25 * 1024 * 1024  # 25 MB


class MediaUpload(BaseModel):
    content_type: str
    data_base64: str


@router.post("/upload")
async def upload_media(
    body: MediaUpload, x_webhook_token: str | None = Header(default=None)
):
    """Llamado por n8n con el base64 del archivo (imagen/video/audio) justo después de descargarlo de Evolution API."""
    if settings.inbound_webhook_token and x_webhook_token != settings.inbound_webhook_token:
        raise HTTPException(status_code=401, detail="Token inválido")

    if not body.content_type.startswith(ALLOWED_CONTENT_PREFIXES):
        raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")

    try:
        raw = base64.b64decode(body.data_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="base64 inválido")

    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande")

    ext = mimetypes.guess_extension(body.content_type) or ""
    filename = f"{uuid.uuid4().hex}{ext}"
    (MEDIA_DIR / filename).write_bytes(raw)

    return {"media_url": f"/media/{filename}"}
