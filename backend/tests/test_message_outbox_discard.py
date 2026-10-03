"""Descartar y reintentar un envío fallido."""

import pytest

from app.modules.conversations.application.outbound import discard_failed_message, retry_failed_message
from app.modules.conversations.domain.errors import NotRetryable
from app.modules.conversations.domain.events import MessageDiscarded, OutboundQueued
from tests.conversation_fakes import failed_message


async def test_discard_closes_the_job_and_marks_the_message(in_memory_conversations):
    failed_message(in_memory_conversations, 42)

    result = await discard_failed_message("lead-1", 42)

    assert result["outbox_status"] == "discarded"
    [event] = in_memory_conversations.of(MessageDiscarded)
    assert (event.chat_id, event.message_id) == ("lead-1", 42)


async def test_discard_ignores_a_message_that_is_not_failed(in_memory_conversations):
    with pytest.raises(NotRetryable) as exc:
        await discard_failed_message("lead-1", 42)

    assert exc.value.status_code == 409
    assert exc.value.detail == "El mensaje no está fallido o ya fue reintentado"
    assert in_memory_conversations.published == []


async def test_retry_reuses_the_failed_message_and_wakes_the_worker(in_memory_conversations):
    failed_message(in_memory_conversations, 7)

    result = await retry_failed_message("lead-1", 7)

    assert result["outbox_status"] == "queued"
    assert in_memory_conversations.outbox.queued == []
    [event] = in_memory_conversations.of(OutboundQueued)
    assert event.message_ids == (7,)


async def test_a_message_from_another_chat_cannot_be_retried(in_memory_conversations):
    failed_message(in_memory_conversations, 7, chat_id="otro-lead")

    with pytest.raises(NotRetryable):
        await retry_failed_message("lead-1", 7)
