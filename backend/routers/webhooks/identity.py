from typing import Any
from fastapi import Body, HTTPException
from services.whatsapp_identity_service import (
    InvalidWhatsAppIdentityError,
    WhatsAppIdentityConflictError,
    parse_message_identity,
    resolve_whatsapp_identity,
)
from routers.webhooks.common import webhooks_router


router = webhooks_router()


@router.post("/resolve-whatsapp-identity")
async def resolve_whatsapp_identity_webhook(
    body: dict[str, Any] = Body(...),
):
    """Devuelve el ``chat_id`` canónico antes de que n8n escriba el mensaje.

    Acepta tanto ``$json.body`` como el item
    completo de n8n. Si solo llega un LID, intenta enriquecerlo mediante los
    contactos sincronizados; si no puede, crea/reutiliza un lead provisional
    con teléfono NULL y conserva el LID como alias estable.
    """
    try:
        identity = parse_message_identity(body)
    except InvalidWhatsAppIdentityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Solo vale preguntarle a Evolution por un LID que todavía no conocemos: si
    # ya es alias de un lead, el mensaje resuelve igual y el teléfono llega por
    # otra vía (learn_send_aliases, al enviarle). Sin este corte se gastaría una
    # llamada HTTP por cada mensaje entrante de todo chat con LID.
    # if identity.lid_jid and not identity.phone_jid and not await is_known_alias(identity.lid_jid):
    #     try:
    #         phone_jid = await find_phone_jid_for_lid(identity.lid_jid)
    #     except EvolutionApiError:
    #         logger.warning(
    #             "No se pudo resolver el LID %s mediante findContacts; se conserva provisional",
    #             identity.lid_jid,
    #             exc_info=True,
    #         )
    #     else:
    #         identity = add_phone_jid(identity, phone_jid)

    try:
        result = await resolve_whatsapp_identity(identity)
    except WhatsAppIdentityConflictError as exc:
        # No se mezclan historiales silenciosamente. Un 409 detiene el flujo de
        # n8n y deja trazabilidad para resolver el duplicado existente.
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Los alias ya están asociados a leads distintos",
                "lead_ids": exc.lead_ids,
            },
        ) from exc

    return {"status": "ok", **result.to_dict()}
