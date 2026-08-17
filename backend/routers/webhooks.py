from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel
from db.models import LeadStage
from services.db_service import (
    attach_outgoing_analysis,
    fetch_latest_message,
    fetch_message_by_wa_id,
    mark_chat_read_from_whatsapp_receipt,
    mark_message_deleted,
    reconcile_outgoing_message,
    set_message_reaction,
    update_poll_results,
    update_lead_stage,
    update_message_content,
    update_message_status,
)
from services.ad_referral_service import rehost_ad_thumbnail
from services.message_status_service import parse_message_status_events
from services.evolution_service import EvolutionApiError, find_phone_jid_for_lid
from services.whatsapp_identity_service import (
    InvalidWhatsAppIdentityError,
    WhatsAppIdentityConflictError,
    add_phone_jid,
    is_known_alias,
    parse_evolution_identity,
    resolve_whatsapp_identity,
)
from services.ws_manager import manager
from services.automation_service import trigger_inbound_message, trigger_stage_changed

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@router.post("/resolve-whatsapp-identity")
async def resolve_whatsapp_identity_webhook(
    body: dict[str, Any] = Body(...),
):
    """Devuelve el ``chat_id`` canónico antes de que n8n escriba el mensaje.

    Acepta tanto ``$json.body`` (webhook nativo de Evolution) como el item
    completo de n8n. Si solo llega un LID, intenta enriquecerlo mediante los
    contactos sincronizados; si no puede, crea/reutiliza un lead provisional
    con teléfono NULL y conserva el LID como alias estable.
    """
    try:
        identity = parse_evolution_identity(body)
    except InvalidWhatsAppIdentityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Solo vale preguntarle a Evolution por un LID que todavía no conocemos: si
    # ya es alias de un lead, el mensaje resuelve igual y el teléfono llega por
    # otra vía (learn_send_aliases, al enviarle). Sin este corte se gastaría una
    # llamada HTTP por cada mensaje entrante de todo chat con LID.
    if identity.lid_jid and not identity.phone_jid and not await is_known_alias(identity.lid_jid):
        try:
            phone_jid = await find_phone_jid_for_lid(identity.lid_jid)
        except EvolutionApiError:
            logger.warning(
                "No se pudo resolver el LID %s mediante findContacts; se conserva provisional",
                identity.lid_jid,
                exc_info=True,
            )
        else:
            identity = add_phone_jid(identity, phone_jid)

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


class NewMessageWebhookBody(BaseModel):
    # n8n manda el id del mensaje que acaba de insertar. Es opcional para no
    # romper si el workflow todavía llama al webhook sin body: en ese caso se
    # cae al último mensaje de la tabla.
    wa_message_id: str | None = None


@router.post("/messages")
async def new_message_webhook(
    body: NewMessageWebhookBody | None = None,
):
    """Llamado por n8n justo después de guardar un mensaje nuevo en la DB."""
    payload = {"type": "chats_updated", "reason": "inbound_message"}
    wa_message_id = body.wa_message_id if body else None
    message = None
    if wa_message_id:
        message = await fetch_message_by_wa_id(wa_message_id)
        if message is None:
            # No debería pasar (n8n avisa después del INSERT), pero si el id no
            # está todavía visible preferimos notificar de más que no notificar.
            logger.warning(
                "Webhook de mensaje con wa_message_id desconocido: %s", wa_message_id
            )
    if message is None:
        message = await fetch_latest_message()

    if wa_message_id:
        # Antes del broadcast: al recargar el hilo el payload ya trae la URL estable.
        await rehost_ad_thumbnail(wa_message_id)

    if message is not None:
        payload["latest_message"] = message
        payload["chat_id"] = message["chat_id"]
        try:
            await trigger_inbound_message(message)
        except Exception:
            logger.exception("No se pudo programar la automatización del mensaje entrante")

    await manager.broadcast(payload)
    return {"status": "ok"}


class ReactionWebhookBody(BaseModel):
    chat_id: str
    # wa_message_id del mensaje reaccionado (key.id del reaccionado, que en el
    # evento de reacción viaja aparte del id de la reacción en sí).
    target_wa_message_id: str
    # Emoji de la reacción. Vacío = el cliente quitó la reacción.
    emoji: str = ""
    # Quién reaccionó: el cliente (False) o nosotros desde un dispositivo
    # vinculado (True). Es key.fromMe del evento de reacción.
    from_me: bool = False


@router.post("/reaction")
async def reaction_webhook(
    body: ReactionWebhookBody,
):
    """Llamado por n8n cuando entra una reacción. En vez de guardarla como un
    mensaje, la mergea sobre el mensaje objetivo (badge estilo WhatsApp) y avisa
    a los paneles para que repinten el hilo."""
    message = await set_message_reaction(
        body.chat_id, body.target_wa_message_id, body.emoji, body.from_me
    )
    # message es None cuando el reaccionado no está en nuestra base (histórico
    # anterior a la integración): no hay burbuja donde colgar el badge, se ignora.
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "reaction"}
        )
    return {"status": "ok", "matched": matched}


class MessageEditedWebhookBody(BaseModel):
    chat_id: str
    # wa_message_id del mensaje editado (el id NO cambia al editar: WhatsApp
    # manda un protocolMessage que apunta al original).
    wa_message_id: str
    text: str


@router.post("/message-edited")
async def message_edited_webhook(
    body: MessageEditedWebhookBody,
):
    """Llamado por n8n cuando WhatsApp avisa que un mensaje se editó.

    Cubre lo que la app no originó: el cliente corrigiendo lo que escribió, o
    el vendedor editando desde el teléfono. La edición hecha desde el CRM ya
    guardó el texto nuevo al llamar a Evolution, así que este webhook la
    reescribe con el mismo valor y no cambia nada.
    """
    message = await update_message_content(body.chat_id, body.wa_message_id, body.text)
    # None cuando el editado no está en nuestra base (histórico anterior a la
    # integración) o ya fue eliminado: no hay burbuja que corregir.
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "message_edited"}
        )
    return {"status": "ok", "matched": matched}


class PollResultsWebhookBody(BaseModel):
    chat_id: str
    target_wa_message_id: str
    # Snapshot normalizado: [{option, voters, count}]. Nunca se reciben aquí
    # encPayload/encIv del voto cifrado.
    results: list[dict[str, Any]]
    voter_id: str | None = None
    mode: str = "snapshot"
    decrypted: bool = True


@router.post("/poll-results")
async def poll_results_webhook(body: PollResultsWebhookBody):
    """Actualiza la encuesta original sin crear una burbuja para cada voto."""
    if not body.decrypted:
        # Un pollUpdateMessage crudo lleva opciones cifradas. Solo Evolution
        # puede descifrarlas; no se pisa un snapshot previo con una lista vacía.
        return {"status": "ok", "matched": False, "ignored": "encrypted_or_empty"}
    if body.mode == "delta" and not body.voter_id:
        return {"status": "ok", "matched": False, "ignored": "missing_voter"}
    message = await update_poll_results(
        body.chat_id,
        body.target_wa_message_id,
        body.results,
        voter_id=body.voter_id,
        mode=body.mode,
    )
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "poll_results"}
        )
    return {"status": "ok", "matched": matched}


class MessageDeletedWebhookBody(BaseModel):
    chat_id: str
    # wa_message_id del mensaje eliminado (el que viaja en el protocolMessage
    # de revoke, no el id del propio aviso).
    wa_message_id: str


@router.post("/message-deleted")
async def message_deleted_webhook(
    body: MessageDeletedWebhookBody,
):
    """Llamado por n8n cuando WhatsApp avisa que un mensaje se eliminó para
    todos. Mismo borrado lógico que hace la app al eliminar desde el CRM: la
    fila queda, el contenido deja de servirse y el hilo muestra la lápida."""
    message = await mark_message_deleted(body.chat_id, body.wa_message_id)
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "message_deleted"}
        )
    return {"status": "ok", "matched": matched}


class OutgoingAnalysisWebhookBody(BaseModel):
    chat_id: str
    # image | video | audio (la media saliente que se analiza).
    message_type: str
    # Enriquecimiento IA ya armado por n8n: {summary, kind, model, generated_at, version}.
    analysis: dict
    # wa_message_id del eco (no matchea con el que guardó la app; se intenta igual).
    wa_message_id: str | None = None
    # Solo se usan si hay que insertar (media enviada desde el teléfono, no la app).
    content: str | None = None
    media_url: str | None = None


@router.post("/analysis")
async def outgoing_analysis_webhook(
    body: OutgoingAnalysisWebhookBody,
):
    """Llamado por n8n con el análisis IA de una media SALIENTE del vendedor.

    La app guarda la media que el vendedor manda pero no la analiza; n8n corre
    el análisis sobre el eco y lo manda acá para fusionarlo en esa misma fila
    (en vez de duplicar el mensaje). Si no encuentra la fila —media mandada
    desde el teléfono— la inserta."""
    result = await attach_outgoing_analysis(
        body.chat_id,
        body.message_type,
        body.analysis,
        wa_message_id=body.wa_message_id,
        content=body.content,
        media_url=body.media_url,
    )
    await manager.broadcast(
        {"type": "chats_updated", "chat_id": body.chat_id, "reason": "analysis"}
    )
    return {"status": "ok", **result}


class OutgoingWebhookBody(BaseModel):
    chat_id: str
    message_type: str = "text"
    content: str | None = None
    wa_message_id: str | None = None
    media_url: str | None = None
    payload: dict | None = None


@router.post("/outgoing")
async def outgoing_webhook(
    body: OutgoingWebhookBody,
):
    """Llamado por n8n con un mensaje SALIENTE (fromMe) que no lleva análisis.

    Reconcilia: descarta el eco de nuestros propios envíos (ya guardados por la
    app) pero conserva los salientes externos —auto-reply de Kommo, mensajes
    escritos desde el teléfono— que solo llegan por acá."""
    result = await reconcile_outgoing_message(
        body.chat_id,
        body.message_type,
        body.content,
        wa_message_id=body.wa_message_id,
        media_url=body.media_url,
        payload=body.payload,
    )
    # Solo avisamos cuando se insertó algo nuevo (un saliente externo); el eco de
    # nuestros propios envíos ya está en pantalla.
    if not result["matched"]:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "outbound_message"}
        )
    return {"status": "ok", **result}


class LeadStageWebhookBody(BaseModel):
    chat_id: str
    # None = el agente no decidió etapa en esta corrida; el webhook no hace
    # nada, así n8n puede llamarlo siempre sin un nodo IF adelante.
    estado: str | None = None
    razonamiento: str | None = None


async def _broadcast_lead_updated(chat_id: str) -> None:
    """Avisa a los paneles abiertos de que el lead cambió por fuera de la app.

    El agente analista de n8n escribe nombre, teléfono, notas y
    servicio_interes con un UPDATE directo a PostgreSQL, y llama a este webhook
    inmediatamente después. Sin este aviso el CRM se queda con los datos viejos
    hasta que otra cosa provoque un refresco: mientras el WebSocket está
    conectado el frontend no hace polling (ver useChats.ts, refetchInterval).
    """
    await manager.broadcast(
        {"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"}
    )


@router.post("/lead-stage")
async def lead_stage_webhook(
    body: LeadStageWebhookBody,
):
    """Llamado por n8n cuando el agente analista termina de analizar el lead.

    Reemplaza el UPDATE directo a ``leads.estado`` que hacía el workflow: al
    pasar por acá el cambio queda auditado en ``lead_activity`` (con el
    razonamiento del agente y la foto del último mensaje del cliente), se
    notifica a los paneles abiertos y se disparan las automatizaciones de
    cambio de etapa.

    Se avisa a los paneles incluso cuando la etapa no se mueve: el agente
    también reescribe el resto de los campos del lead, y mantener la etapa es
    su respuesta más frecuente. Sin ese aviso, un nombre recién deducido de la
    conversación no aparecía en pantalla hasta el siguiente mensaje.
    """
    if body.estado is None:
        await _broadcast_lead_updated(body.chat_id)
        return {"status": "ok", "changed": False, "stage": None}

    try:
        stage = LeadStage(body.estado)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Estado inválido: {body.estado!r}. Válidos: {[s.value for s in LeadStage]}",
        )

    metadata = {"reason": body.razonamiento} if body.razonamiento else None
    result = await update_lead_stage(
        body.chat_id, stage, actor_type="agent", metadata=metadata, include_chat=False
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    if result["changed"]:
        await manager.broadcast(
            {
                "type": "chats_updated",
                "chat_id": body.chat_id,
                "reason": "stage_changed",
                "lead_stage_updated": {"chat_id": body.chat_id, "stage": stage.value},
            }
        )
        try:
            await trigger_stage_changed(body.chat_id)
        except Exception:
            logger.exception("No se pudo programar la automatización de cambio de etapa del webhook")
    else:
        # La etapa no se movió, pero el analista sí tocó el resto del lead.
        await _broadcast_lead_updated(body.chat_id)

    return {"status": "ok", "changed": result["changed"], "stage": stage.value}


@router.post("/message-status")
async def message_status_webhook(
    body: dict[str, Any] | list[dict[str, Any]] = Body(...),
):
    """Recibe un cambio de estado desde n8n o directamente desde Evolution.

    Acepta tanto ``{wa_message_id, status, from_me}`` como el evento nativo
    ``MESSAGES_UPDATE`` (incluidos lotes y estados numéricos 2–5). Cuando un
    mensaje del cliente llega como READ/PLAYED con ``from_me=false``, también
    sincroniza el contador interno de no leídos con WhatsApp Web.
    """
    events = parse_message_status_events(body)
    if not events:
        raise HTTPException(status_code=422, detail="No se encontró un ID y estado de mensaje válidos")

    changed = []
    read_synced = []
    for event in events:
        updated = await update_message_status(event.wa_message_id, event.status.value)
        if updated is not None:
            changed.append(updated)

        if event.from_me is False and event.status.value in {"READ", "PLAYED"}:
            read_update = await mark_chat_read_from_whatsapp_receipt(event.wa_message_id)
            if read_update is not None:
                read_synced.append(read_update)

    if changed or read_synced:
        read_synced_chat_ids = {item["chat_id"] for item in read_synced if item.get("chat_id")}
        chat_ids = {
            item["chat_id"]
            for item in [*changed, *read_synced]
            if item.get("chat_id")
        }
        if chat_ids:
            for chat_id in chat_ids:
                status_updates = [
                    {"id": item["id"], "status": item["status"]}
                    for item in changed
                    if item.get("chat_id") == chat_id
                ]
                # Si este chat tuvo un recibo de lectura nativo de WhatsApp,
                # last_read_at ya avanzó en la base: hay que avisarle al
                # frontend con "read" (igual que el POST /read manual) para
                # que refresque el badge, no con "message_status" (que solo
                # actualiza tiques y no invalida unread_count).
                reason = "read" if chat_id in read_synced_chat_ids else "message_status"
                await manager.broadcast(
                    {
                        "type": "chats_updated",
                        "chat_id": chat_id,
                        "reason": reason,
                        "message_statuses": status_updates,
                    }
                )
        else:
            await manager.broadcast({"type": "chats_updated", "reason": "message_status"})

    return {
        "status": "ok",
        "matched": bool(changed or read_synced),
        "received_count": len(events),
        "updated_count": len(changed),
        "read_count": len(read_synced),
    }
