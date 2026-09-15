import asyncio
import re
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.media_storage import (
    MediaNotFoundError,
    MediaStorageError,
    iter_media_stat,
    stat_media,
)
from services.media_upload import save_media_file

router = APIRouter(prefix="/api/media", tags=["media"])
files_router = APIRouter(tags=["media-files"])

class MediaUpload(BaseModel):
    content_type: str
    data_base64: str


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


def _content_disposition(filename: str) -> str:
    """Cabecera segura y UTF-8 para guardar un archivo con nombre humano."""
    # El nombre viene de un query param: nunca debe poder inyectar cabeceras ni
    # convertirse en una ruta. ``filename*`` conserva tildes y emojis, mientras
    # el fallback ASCII cubre navegadores antiguos.
    cleaned = filename.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r'[\x00-\x1f\x7f"]', "_", cleaned).strip()[:180] or "archivo"
    fallback = cleaned.encode("ascii", "ignore").decode() or "archivo"
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{quote(cleaned)}'


@files_router.get("/media/{filename}")
@files_router.head("/media/{filename}")
def get_media_file(
    filename: str,
    request: Request,
    range_header: str | None = Header(default=None, alias="Range"),
    download: str | None = Query(default=None, max_length=255),
):
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
    if download:
        # Content-Disposition hace que la descarga también funcione en Safari
        # móvil y cuando frontend/backend están en orígenes distintos (donde
        # el atributo HTML ``download`` por sí solo se ignora).
        headers["Content-Disposition"] = _content_disposition(download)
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{start + length - 1}/{info.size}"
    if request.method == "HEAD":
        return Response(status_code=status_code, headers=headers, media_type=info.content_type)
    return StreamingResponse(
        # Se reutiliza el stat de arriba: iter_media volvía a pedirlo, así que
        # servir una imagen costaba dos consultas a MinIO en vez de una.
        iter_media_stat(info, media_url, start, length),
        status_code=status_code,
        headers=headers,
        media_type=info.content_type,
    )


@router.post("/upload")
async def upload_media(body: MediaUpload):
    """Llamado por n8n con el base64 del archivo (imagen/video/audio) justo después de descargarlo de Evolution API."""
    try:
        media_url = await asyncio.to_thread(save_media_file, body.content_type, body.data_base64)
    except ValueError as e:
        status = 413 if "grande" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    except MediaStorageError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return {"media_url": media_url}
