"""Sincronizacion de plantillas oficiales iniciada por webhooks de Meta."""

from fastapi import HTTPException

from routers.webhooks.common import webhooks_router
from services.meta_service import MetaApiError, describe_template_error, get_whatsapp_template
from services.template_service import replace_official_template_from_meta
from services.ws_manager import manager


router = webhooks_router()


@router.put("/templates/{meta_template_id}")
async def replace_template_from_meta_webhook(meta_template_id: str):
    """Obtiene la fuente completa en Meta y sustituye sus campos locales.

    El PUT es idempotente: no confia en que cada tipo de webhook traiga todos
    los campos ni en el orden de entrega de eventos de estado, categoria o
    componentes.
    """

    try:
        remote = await get_whatsapp_template(meta_template_id)
    except MetaApiError as exc:
        raise HTTPException(502, describe_template_error(exc)) from exc

    template_ids = await replace_official_template_from_meta(meta_template_id, remote)
    if template_ids:
        await manager.broadcast(
            {
                "type": "templates_updated",
                "template_ids": template_ids,
                "source": "meta_webhook",
            }
        )

    return {
        "status": "ok",
        "matched": bool(template_ids),
        "updated_count": len(template_ids),
    }
