"""Procesa un ``change`` de Meta ya guardado en el inbox.

Orden: resolver el negocio por ``phone_number_id`` (o la WABA, en eventos de
plantillas), abrir su contexto y aplicar un handler por ``field``. Dentro de
``messages`` cada raíz se guarda con su tipo y subtipo literales; lo que la UI
no sabe mostrar todavía se guarda igual y deja una métrica.

Es un adaptador de entrada: traduce el JSON de Meta y llama a los comandos de
``conversations``. Avisar a los paneles, disparar automatizaciones y completar
tareas lo hacen los suscriptores de los eventos que esos comandos publican.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.integrations.meta import client as meta_service
from app.modules.leads.ports.ad_referral_service import (rehost_referral_image)
from app.modules.conversations.ports.inbound import (
    attach_media,
    receive_provider_message,
    record_provider_reaction,
    record_provider_status,
    set_message_payload,
)
from app.modules.conversations.ports.message_queries import chat_id_for_wa_message
from app.modules.media.ports.media_upload import (save_decoded_media)
from app.integrations.meta.contract import contract, is_known_inbound, message_subtype
from app.integrations.meta_webhook import metrics
from app.integrations.meta_webhook.inbox import InboxEvent
from app.integrations.meta_webhook.projection import project, quoted_wa_message_id
from app.modules.catalogs.ports.template_service import (replace_official_template_from_meta)
from app.integrations.whatsapp.identity import (
    WA_ID,
    ContactIdentity,
    add_identity_alias,
    identity_from_echo,
    identity_from_inbound,
    resolve_whatsapp_identity,
)
from app.core.events import publish
from app.modules.catalogs.public import TemplatesChanged
from app.tenancy.context import TenantContext, tenant_context
from app.tenancy.resolver import resolve_tenant_by_phone_number_id, resolve_tenant_by_waba_id

logger = logging.getLogger(__name__)

TEMPLATE_FIELDS = frozenset({
    "message_template_status_update",
    "template_category_update",
    "message_template_components_update",
})
class UnroutableChange(RuntimeError):
    """El número o la WABA del evento no pertenece a ningún negocio activo."""


class MediaImportError(RuntimeError):
    """El mensaje quedó guardado pero su adjunto no se pudo bajar de Meta."""


def _timestamp(value: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _phone_number_id(value: dict) -> str | None:
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    phone_number_id = metadata.get("phone_number_id")
    return phone_number_id if isinstance(phone_number_id, str) and phone_number_id else None


async def _tenant_for(change: dict) -> TenantContext | None:
    if not settings.multitenancy_enabled:
        return None
    field = change["field"]
    value = change.get("value") if isinstance(change.get("value"), dict) else {}
    if field in TEMPLATE_FIELDS:
        waba_id = change.get("entry_id")
        context = await resolve_tenant_by_waba_id(str(waba_id)) if waba_id else None
    else:
        phone_number_id = _phone_number_id(value)
        context = await resolve_tenant_by_phone_number_id(phone_number_id) if phone_number_id else None
    if context is None:
        metrics.webhook_unrouted_changes.labels(field=field).inc()
        raise UnroutableChange(f"Evento {field} sin negocio activo para su número o WABA")
    return context


async def _import_media(stored: dict, message: dict) -> None:
    projection = project(message)
    if not projection.media_id or stored.get("media_url"):
        return
    try:
        content, content_type = await meta_service.download_media(projection.media_id)
        media_url = await asyncio.to_thread(
            save_decoded_media, content_type, content, projection.media_filename
        )
    except Exception as exc:
        metrics.media_download_failures.labels(message_type=stored["message_type"] or "").inc()
        raise MediaImportError(
            f"No se pudo bajar el adjunto {projection.media_id} de {stored['wa_message_id']}: {exc}"
        ) from exc
    await attach_media(stored["chat_id"], stored["id"], media_url)


async def _rehost_referral(stored: dict, message: dict) -> None:
    media_url = await rehost_referral_image(message.get("referral"))
    if media_url:
        await set_message_payload(stored["id"], {**(stored.get("payload") or {}), "referral_thumbnail_url": media_url})


async def _store_message(
    message: dict,
    chat_id: str,
    *,
    sender: str,
    webhook_event_id: str,
) -> tuple[dict, bool]:
    raw_type = message.get("type")
    message_type = raw_type if isinstance(raw_type, str) else None
    subtype = message_subtype(message)
    if not is_known_inbound(message_type, subtype):
        # Se guarda con su nombre literal: la alerta avisa que falta un
        # renderer, no que se perdió un mensaje.
        metrics.unrendered_messages.labels(
            message_type=message_type or "", message_subtype=subtype or ""
        ).inc()
        logger.warning("Mensaje de Meta con tipo sin renderer: %s/%s", message_type, subtype)
    return await receive_provider_message(
        chat_id=chat_id,
        sender=sender,
        wa_message_id=message["id"],
        message_type=message_type,
        message_subtype=subtype,
        provider_payload=message,
        content=project(message).content,
        sent_at=_timestamp(message.get("timestamp")),
        quoted_wa_message_id=quoted_wa_message_id(message),
        webhook_event_id=webhook_event_id,
        human_outbound=True if sender == "vendedor" else None,
    )


async def _reaction(message: dict, chat_id: str | None, *, actor: str, webhook_event_id: str) -> None:
    reaction = message.get("reaction") if isinstance(message.get("reaction"), dict) else {}
    target = reaction.get("message_id")
    if not isinstance(target, str) or not target:
        return
    emoji = reaction.get("emoji") if isinstance(reaction.get("emoji"), str) else ""
    target_chat_id = await chat_id_for_wa_message(target) or chat_id
    await record_provider_reaction(
        event_wa_id=message.get("id"),
        target_wa_message_id=target,
        chat_id=target_chat_id,
        emoji=emoji,
        actor=actor,
        provider_payload=message,
        occurred_at=_timestamp(message.get("timestamp")),
        webhook_event_id=webhook_event_id,
    )
    if target_chat_id is None:
        metrics.unmatched_messages.labels(kind="reaction").inc()


async def _learn_changed_number(message: dict, chat_id: str, phone_number_id: str) -> None:
    system = message.get("system") if isinstance(message.get("system"), dict) else {}
    if system.get("type") == "user_changed_number" and isinstance(system.get("new_wa_id"), str):
        await add_identity_alias(chat_id, phone_number_id, WA_ID, system["new_wa_id"])


async def _conversation_message(
    message: dict,
    identity: ContactIdentity,
    *,
    inbound: bool,
    webhook_event_id: str,
) -> None:
    resolved = await resolve_whatsapp_identity(identity)
    if message.get("type") == "reaction":
        await _reaction(
            message, resolved.chat_id, actor="customer" if inbound else "business",
            webhook_event_id=webhook_event_id,
        )
        return
    if not isinstance(message.get("id"), str):
        logger.warning("Mensaje de Meta sin id: se descarta la proyección, el evento queda en el inbox")
        return
    stored, created = await _store_message(
        message,
        resolved.chat_id,
        sender="cliente" if inbound else "vendedor",
        webhook_event_id=webhook_event_id,
    )
    if created:
        if message.get("type") == "system":
            await _learn_changed_number(message, resolved.chat_id, identity.phone_number_id)
        if message.get("referral"):
            await _rehost_referral(stored, message)
    # Fuera del ``if created``: en un reintento el mensaje ya existe pero el
    # adjunto puede seguir pendiente.
    await _import_media(stored, message)


async def _status(status: dict, webhook_event_id: str) -> None:
    value = status.get("status")
    if value not in contract().statuses:
        metrics.unknown_statuses.labels(status=str(value)).inc()
        logger.warning("Estado de Meta sin proyección: %s", value)
    for error in status.get("errors") or []:
        if isinstance(error, dict):
            metrics.outbound_meta_errors.labels(code=str(error.get("code"))).inc()
    await record_provider_status(
        status, occurred_at=_timestamp(status.get("timestamp")), webhook_event_id=webhook_event_id,
    )


async def _messages_change(change: dict, webhook_event_id: str) -> None:
    value = change.get("value") if isinstance(change.get("value"), dict) else {}
    phone_number_id = _phone_number_id(value)
    if phone_number_id is None:
        raise UnroutableChange("Evento de mensajes sin metadata.phone_number_id")
    contacts = value.get("contacts") if isinstance(value.get("contacts"), list) else []

    for status in value.get("statuses") or []:
        if isinstance(status, dict):
            await _status(status, webhook_event_id)
    for message in value.get("messages") or []:
        if isinstance(message, dict):
            await _conversation_message(
                message,
                identity_from_inbound(phone_number_id, message, contacts),
                inbound=True,
                webhook_event_id=webhook_event_id,
            )
    for echo in value.get("message_echoes") or []:
        if isinstance(echo, dict):
            await _conversation_message(
                echo,
                identity_from_echo(phone_number_id, echo),
                inbound=False,
                webhook_event_id=webhook_event_id,
            )
    for error in value.get("errors") or []:
        logger.warning("Meta informó un error en el webhook: %s", error)


async def _template_change(change: dict, _webhook_event_id: str) -> None:
    value = change.get("value") if isinstance(change.get("value"), dict) else {}
    template_id = value.get("message_template_id") or value.get("template_id") or value.get("id")
    if not template_id:
        raise ValueError(f"Evento {change['field']} sin id de plantilla")
    remote = await meta_service.get_whatsapp_template(str(template_id))
    template_ids = await replace_official_template_from_meta(str(template_id), remote)
    if template_ids:
        await publish(TemplatesChanged(template_ids=tuple(template_ids), source="meta_webhook"))


ChangeHandler = Callable[[dict, str], Awaitable[None]]

FIELD_HANDLERS: dict[str, ChangeHandler] = {
    "messages": _messages_change,
    # Coexistencia: lo que el negocio manda desde la app de WhatsApp Business.
    "smb_message_echoes": _messages_change,
    **{field: _template_change for field in TEMPLATE_FIELDS},
}


async def process_change(event: InboxEvent) -> None:
    change = event.payload
    handler = FIELD_HANDLERS.get(change.get("field"))
    if handler is None:
        metrics.webhook_ignored_fields.labels(field=str(change.get("field"))).inc()
        logger.info("Field de Meta sin handler: %s", change.get("field"))
        return
    context = await _tenant_for(change)
    scope = tenant_context(context) if context is not None else contextlib.nullcontext()
    with scope:
        await handler(change, event.id)
