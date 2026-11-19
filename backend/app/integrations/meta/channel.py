from __future__ import annotations

from app.integrations.meta import client as meta_service
from app.integrations.whatsapp.channel import CallRefused, ChannelAvailability, SendReceipt


class MetaMessageSender:
    async def send(self, chat_id: str, message: dict) -> SendReceipt:
        result = await meta_service.send_message(chat_id, message)
        response = result["response"]
        messages = response.get("messages") or []
        contacts = response.get("contacts") or []
        return SendReceipt(
            provider_message_id=messages[0].get("id") if messages else None,
            sent_body=result["body"],
            recipient_wa_id=contacts[0].get("wa_id") if contacts else None,
        )

    async def send_to_number(self, wa_id: str, message: dict, *, sender: str | None = None) -> SendReceipt:
        """``sender`` sale desde otro número de la misma WABA (el número de
        avisos de cita); sin él, desde el número del CRM."""
        result = await meta_service.send_message_to_number(wa_id, message, sender_phone_number_id=sender)
        return _direct_receipt(result)

    async def send_from(self, chat_id: str, message: dict, *, sender: str) -> SendReceipt:
        """Al lead desde el número de avisos, sin pasar por su chat."""
        result = await meta_service.send_message_to_lead_from(chat_id, message, sender_phone_number_id=sender)
        return _direct_receipt(result)

    async def upload_media(
        self, content: bytes, content_type: str, filename: str, *, sender: str | None = None,
    ) -> str:
        return await meta_service.upload_media(content, content_type, filename, sender_phone_number_id=sender)


def _direct_receipt(result: dict) -> SendReceipt:
    messages = result["response"].get("messages") or []
    return SendReceipt(
        provider_message_id=messages[0].get("id") if messages else None,
        sent_body=result["body"],
    )


class MetaAccountNumbers:
    """Los números de las WABA del negocio, su ruteo de webhooks y las
    plantillas de cada una. Lo usa el número de avisos de cita: otro número
    de la WABA del CRM o de otra WABA del mismo portfolio."""

    async def list(self, waba_id: str | None = None) -> list[dict]:
        return await meta_service.list_phone_numbers(waba_id)

    async def account_name(self, waba_id: str) -> str:
        return await meta_service.get_waba_name(waba_id)

    async def register(self, phone_number_id: str, waba_id: str | None = None) -> None:
        await meta_service.register_extra_number(phone_number_id, waba_id)

    async def unregister(self, phone_number_id: str) -> None:
        await meta_service.unregister_extra_number(phone_number_id)

    async def complete_signup(self, code: str, waba_id: str, phone_number_id: str | None) -> dict[str, str]:
        return await meta_service.complete_notice_number_signup(code, waba_id, phone_number_id)

    async def templates(self, waba_id: str) -> list[dict]:
        return await meta_service.list_whatsapp_templates(waba_id)

    async def copy_template(self, meta_template_id: str, waba_id: str) -> dict:
        return await meta_service.copy_whatsapp_template(meta_template_id, waba_id)


class MetaCallControl:
    async def accept(self, call_id: str, sdp: str, *, pre_accept: bool = False) -> None:
        if pre_accept:
            # Deja lista la conexión de audio antes de aceptar, para que no se
            # corten las primeras palabras. Meta exige el mismo SDP en los dos.
            await meta_service.call_action("pre_accept", call_id, sdp=sdp)
        await meta_service.call_action("accept", call_id, sdp=sdp)

    async def reject(self, call_id: str) -> None:
        await meta_service.call_action("reject", call_id)

    async def start(self, chat_id: str, sdp: str, *, opaque: str) -> str:
        try:
            return await meta_service.start_call(chat_id, sdp, opaque=opaque)
        except meta_service.MetaApiError as exc:
            # El código de Meta dice por qué (sin permiso, límite...): viaja
            # en el error para que quede como causa de la llamada.
            code = exc.error.get("code") if isinstance(exc.error, dict) else None
            raise CallRefused(str(exc), code=str(code) if code is not None else None, status_code=exc.status_code) from exc

    async def permission(self, chat_id: str) -> dict:
        return await meta_service.get_call_permission(chat_id)

    async def terminate(self, call_id: str) -> None:
        await meta_service.call_action("terminate", call_id)


class MetaConversationActions:
    async def mark_read(self, chat_id: str, provider_message_ids: list[str]) -> None:
        await meta_service.mark_messages_as_read(chat_id, provider_message_ids)


MISSING_CONFIG_REASON = (
    "Falta configurar el token, el phone number id y el WABA id de Meta Cloud "
    "API en Configuración."
)


class MetaChannelStatus:
    async def availability(self) -> ChannelAvailability:
        configured = await meta_service.is_configured()
        return ChannelAvailability(
            integration="WHATSAPP-BUSINESS" if configured else None,
            configured=configured,
            reason=None if configured else MISSING_CONFIG_REASON,
        )
