from unittest.mock import AsyncMock

import pytest

from routers import webhooks
from routers.webhooks import ReactionWebhookBody

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


@pytest.mark.asyncio
async def test_reaction_on_known_message_merges_and_broadcasts(monkeypatch):
    set_reaction = AsyncMock(return_value={"id": 42, "reactions": [{"emoji": "❤️", "from_me": False}]})
    monkeypatch.setattr(webhooks, "set_message_reaction", set_reaction)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.reaction_webhook(
        ReactionWebhookBody(
            chat_id=LEAD_ID,
            target_wa_message_id="WA-TARGET",
            emoji="❤️",
            from_me=False,
        )
    )

    set_reaction.assert_awaited_once_with(LEAD_ID, "WA-TARGET", "❤️", False)
    broadcast.assert_awaited_once_with(
        {"type": "chats_updated", "chat_id": LEAD_ID, "reason": "reaction"}
    )
    assert result == {"status": "ok", "matched": True}


@pytest.mark.asyncio
async def test_reaction_on_unknown_target_is_ignored_without_broadcast(monkeypatch):
    # El mensaje reaccionado no está en la base (histórico previo): no hay dónde
    # colgar el badge, así que no se avisa a los paneles.
    monkeypatch.setattr(webhooks, "set_message_reaction", AsyncMock(return_value=None))
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.reaction_webhook(
        ReactionWebhookBody(
            chat_id=LEAD_ID,
            target_wa_message_id="WA-UNKNOWN",
            emoji="👍",
        )
    )

    broadcast.assert_not_awaited()
    assert result == {"status": "ok", "matched": False}
