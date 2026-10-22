from app.integrations.meta import client as meta_service
from app.integrations.whatsapp.channel import ChannelAvailability, SendReceipt


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

    async def upload_media(self, content: bytes, content_type: str, filename: str) -> str:
        return await meta_service.upload_media(content, content_type, filename)


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
