from app.integrations.meta.channel import MetaChannelStatus, MetaConversationActions, MetaMessageSender
from app.integrations.evolution.channel import (
    EvolutionChannelStatus,
    EvolutionConversationActions,
    EvolutionMessageSender,
)
from app.integrations.whatsapp.channel import WhatsAppChannel

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


def channel_for(provider: str | None, connection: str | None) -> WhatsAppChannel:
    if provider in (None, "meta"):
        return CHANNELS["meta"]
    if provider == "evolution" and connection:
        return WhatsAppChannel(
            name="evolution",
            sender=EvolutionMessageSender(connection),
            actions=EvolutionConversationActions(connection),
            status=EvolutionChannelStatus(connection),
        )
    raise ValueError(f"Canal de WhatsApp desconocido: {provider}/{connection}")
