"""Rehospedaje de la miniatura de un anuncio Click-to-WhatsApp.

`payload.ad_referral.thumbnail_url` llega como URL firmada de fbcdn/instagram que
caduca a los pocos días; se descarga y se guarda en MinIO para dejar en el payload la
URL estable ``/media/...``.
"""

import asyncio
import hashlib
import logging

import httpx

from services import db_service
from services.media_storage import MediaStorageError, save_media_bytes

logger = logging.getLogger(__name__)

_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

_DOWNLOAD_TIMEOUT = 8.0
_MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024


def _needs_rehost(thumbnail_url: object) -> str | None:
    """Devuelve la URL externa a rehospedar, o None si no aplica (ya es local,
    vacía o no es http)."""
    if not isinstance(thumbnail_url, str):
        return None
    url = thumbnail_url.strip()
    if not url.startswith(("http://", "https://")):
        return None
    return url


async def rehost_ad_thumbnail(wa_message_id: str) -> None:
    """Si el mensaje trae un anuncio con miniatura externa, la descarga, la guarda
    en MinIO y reescribe ``payload.ad_referral.thumbnail_url`` a la URL estable.

    Best-effort: cualquier fallo deja la miniatura original y no interrumpe el
    aviso del webhook."""
    try:
        row = await db_service.fetch_message_ad_payload(wa_message_id)
    except Exception:
        logger.exception("No se pudo leer el mensaje para rehospedar la miniatura del anuncio")
        return
    if not row:
        return
    payload = row["payload"]
    ad = payload.get("ad_referral") if isinstance(payload, dict) else None
    if not isinstance(ad, dict):
        return
    url = _needs_rehost(ad.get("thumbnail_url"))
    if url is None:
        return

    try:
        async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.content
        if not data or len(data) > _MAX_THUMBNAIL_BYTES:
            return
        content_type = (resp.headers.get("content-type") or "image/jpeg").split(";")[0].strip().lower()
        ext = _EXT_BY_CONTENT_TYPE.get(content_type)
        if ext is None:
            content_type, ext = "image/jpeg", "jpg"
        filename = f"ad-{hashlib.sha256(url.encode()).hexdigest()[:24]}.{ext}"
        media_url = await asyncio.to_thread(save_media_bytes, filename, data, content_type)
    except (httpx.HTTPError, MediaStorageError):
        logger.warning("No se pudo rehospedar la miniatura del anuncio (%s)", wa_message_id)
        return
    except Exception:
        logger.exception("Fallo inesperado rehospedando la miniatura del anuncio")
        return

    new_ad = {**ad, "thumbnail_url": media_url}
    new_ad.setdefault("thumbnail_source_url", url)
    new_payload = {**payload, "ad_referral": new_ad}
    try:
        await db_service.update_message_payload(row["id"], new_payload)
    except Exception:
        logger.exception("No se pudo guardar la miniatura rehospedada del anuncio")
