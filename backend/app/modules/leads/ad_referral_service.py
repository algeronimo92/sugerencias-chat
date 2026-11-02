"""Rehospedaje de la imagen de un anuncio Click-to-WhatsApp.

Meta manda el anuncio en ``messages[].referral`` con URLs firmadas de su CDN
(``thumbnail_url``/``image_url``) que caducan a los pocos días. La imagen se
descarga y se guarda en el almacenamiento propio; la URL estable queda en la
proyección ``payload.referral_thumbnail_url`` y el ``referral`` original sigue
intacto en ``provider_payload``.
"""

import asyncio
import hashlib
import logging

import httpx

from app.integrations.storage.media_storage import (MediaStorageError, save_media_bytes)

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


def referral_image_url(referral: object) -> str | None:
    """URL externa de la imagen del anuncio, o None si no hay una http(s)."""
    if not isinstance(referral, dict):
        return None
    for field in ("thumbnail_url", "image_url"):
        value = referral.get(field)
        if isinstance(value, str) and value.strip().startswith(("http://", "https://")):
            return value.strip()
    return None


async def rehost_referral_image(referral: object) -> str | None:
    """Guarda la imagen del anuncio y devuelve su ``media_url`` estable.

    Best-effort: cualquier fallo devuelve None y el mensaje sigue su curso.
    """
    url = referral_image_url(referral)
    if url is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.content
        if not data or len(data) > _MAX_THUMBNAIL_BYTES:
            return None
        content_type = (resp.headers.get("content-type") or "image/jpeg").split(";")[0].strip().lower()
        ext = _EXT_BY_CONTENT_TYPE.get(content_type)
        if ext is None:
            content_type, ext = "image/jpeg", "jpg"
        filename = f"ad-{hashlib.sha256(url.encode()).hexdigest()[:24]}.{ext}"
        return await asyncio.to_thread(save_media_bytes, filename, data, content_type)
    except (httpx.HTTPError, MediaStorageError):
        logger.warning("No se pudo rehospedar la imagen del anuncio %s", url)
        return None
    except Exception:
        logger.exception("Fallo inesperado rehospedando la imagen del anuncio")
        return None
