from services import meta_service
from services.whatsapp_channel import ReactionTarget, SendReceipt


def _receipt(response: dict) -> SendReceipt:
    key = response.get("key") or {}
    return SendReceipt(
        provider_message_id=key.get("id") or response.get("messageId") or response.get("id"),
        recipient_jid=key.get("remoteJid"),
    )


class MetaMessageSender:
    async def send_text(self, chat_id: str, text: str, quoted: dict | None = None) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_text(chat_id, text, quoted=quoted))

    async def send_media(
        self,
        chat_id: str,
        content: bytes,
        content_type: str,
        mediatype: str,
        *,
        filename: str | None = None,
        caption: str | None = None,
        quoted: dict | None = None,
    ) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_media(
            chat_id, content, content_type, mediatype, filename=filename, caption=caption, quoted=quoted,
        ))

    async def send_audio(
        self, chat_id: str, content: bytes, content_type: str, filename: str | None = None, quoted: dict | None = None,
    ) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_audio(chat_id, content, content_type, filename, quoted=quoted))

    async def send_sticker(self, chat_id: str, sticker_bytes: bytes) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_sticker(chat_id, sticker_bytes))

    async def send_location(
        self, chat_id: str, latitude: float, longitude: float, quoted: dict | None = None,
    ) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_location(chat_id, latitude, longitude, quoted=quoted))

    async def send_template(self, chat_id: str, name: str, language: str, components: list[dict]) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_template(chat_id, name, language, components))

    async def send_buttons(
        self, chat_id: str, title: str, description: str, footer: str, buttons: list[dict],
    ) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_buttons(chat_id, title, description, footer, buttons))

    async def send_list(
        self, chat_id: str, title: str, description: str, footer: str, button_text: str, sections: list[dict],
    ) -> SendReceipt:
        return _receipt(await meta_service.send_whatsapp_list(
            chat_id, title, description, footer, button_text, sections,
        ))


class MetaConversationActions:
    async def react(self, target: ReactionTarget, emoji: str) -> None:
        await meta_service.send_whatsapp_reaction(
            {"remoteJid": target.chat_id, "fromMe": target.from_me, "id": target.provider_message_id}, emoji,
        )

    async def mark_read(self, chat_id: str, provider_message_ids: list[str]) -> None:
        await meta_service.mark_messages_as_read(chat_id, provider_message_ids)
