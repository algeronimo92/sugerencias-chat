from services.meta_channel import MetaChannelStatus, MetaConversationActions, MetaMessageSender
from services.whatsapp_channel import WhatsAppChannel

ACTIVE_CHANNEL = "meta"

CHANNELS: dict[str, WhatsAppChannel] = {
    "meta": WhatsAppChannel(
        name="meta",
        sender=MetaMessageSender(),
        actions=MetaConversationActions(),
        status=MetaChannelStatus(),
    ),
}


def current_channel() -> WhatsAppChannel:
    return CHANNELS[ACTIVE_CHANNEL]
