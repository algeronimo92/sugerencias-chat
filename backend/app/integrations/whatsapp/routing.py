from sqlalchemy import select

from app.db.models.conversations import WspMessage
from app.db.uow import session_scope
from app.integrations.whatsapp.channels import channel_for
from app.integrations.whatsapp.channel import WhatsAppChannel


async def route_for_chat(chat_id: str) -> tuple[str, str | None]:
    async with session_scope() as session:
        row = (
            await session.execute(
                select(WspMessage.channel_provider, WspMessage.channel_connection)
                .where(
                    WspMessage.chat_id == chat_id,
                    WspMessage.channel_provider.isnot(None),
                )
                .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
                .limit(1)
            )
        ).first()
    return (row[0], row[1]) if row else ("meta", None)


async def channel_for_chat(chat_id: str) -> WhatsAppChannel:
    provider, connection = await route_for_chat(chat_id)
    return channel_for(provider, connection)
