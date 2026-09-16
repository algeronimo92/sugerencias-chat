import logging

import asyncio
import base64

from fastapi import HTTPException
from services import meta_service
from services.meta_service import MetaApiError
from services.media_storage import MediaStorageError
from services.media_upload import save_media_file
from models.webhook_schemas import MetaMediaImportBody
from routers.webhooks.common import webhooks_router


router = webhooks_router()
logger = logging.getLogger(__name__)


@router.post("/meta-media")
async def meta_media_import_webhook(body: MetaMediaImportBody):
    """Trae un adjunto entrante desde Meta y lo guarda en el almacenamiento
    propio, devolviendo la `media_url` estable que espera el resto de la app.

    Reemplaza al par de nodos `get X` + `upload X media` de rag.json (que
    bajaba el archivo de Evolution y lo resubía en base64). Vive acá y no en
    n8n porque la descarga necesita el token de Meta, que solo está en las
    settings del backend -así n8n nunca necesita una copia."""
    try:
        content, content_type = await meta_service.download_media(body.media_id)
    except MetaApiError as exc:
        logger.warning("No se pudo bajar el medio %s de Meta: %s", body.media_id, exc)
        raise HTTPException(status_code=502, detail=str(exc))

    encoded = base64.b64encode(content).decode("ascii")
    try:
        media_url = await asyncio.to_thread(
            save_media_file, content_type, encoded, body.filename
        )
    except ValueError as exc:
        raise HTTPException(status_code=413 if "grande" in str(exc) else 400, detail=str(exc))
    except MediaStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {"media_url": media_url, "content_type": content_type}
