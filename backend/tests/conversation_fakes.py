"""Dobles en memoria para los casos de uso de conversations, sin PostgreSQL.

``in_memory_conversations`` instala los puertos (outbox, bandeja, mensajes,
programados, contrato de Meta, canal) y una unidad de trabajo falsa que guarda
los eventos publicados en vez de despacharlos a los suscriptores reales.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from itertools import count

import pytest

from app.core import events
from app.db import uow
from app.integrations.meta.outbound import OutboundRejected, reaction_message, text_item
from app.integrations.whatsapp.channel import SendReceipt
from app.modules.conversations.application import ports
from app.modules.conversations.application.ports import ConversationPorts
from domain_types import ScheduledMessageStatus


class FakeOutbox:
    def __init__(self) -> None:
        self._ids = count(1)
        self.queued: list[dict] = []
        self.by_key: dict[str, dict] = {}
        self.failed: dict[int, dict] = {}
        self.sent: list[tuple[dict, SendReceipt]] = []
        self.failures: list[dict] = []
        self.scheduled_message_ids: set[int] = set()

    async def queued_by_dedupe_key(self, keys):
        return {key: self.by_key[key] for key in keys if key in self.by_key}

    async def queue(self, chat_id, item, *, sent_at, sent_by_user_id, actor_user_id):
        message = {
            "id": next(self._ids),
            "chat_id": chat_id,
            "sender": "vendedor",
            "content": item.get("content"),
            "media_url": item.get("media_url"),
            "outbox_status": "queued",
            "provider_payload": item["message"],
            "sent_by_user_id": sent_by_user_id,
            "sent_at": sent_at,
            "payload": item.get("payload"),
            "job": {
                "media": item.get("media"),
                "header_media": item.get("header_media"),
                "actor_user_id": actor_user_id,
                "forwarded": item.get("forwarded"),
                "quoted_wa_message_id": (item.get("reply_to") or {}).get("wa_message_id"),
            },
        }
        self.queued.append(message)
        if item.get("dedupe_key"):
            self.by_key[item["dedupe_key"]] = message
        return message

    async def reopen_failed(self, chat_id, message_id, now):
        message = self.failed.pop(message_id, None)
        if message is None or message["chat_id"] != chat_id:
            return None
        return {**message, "outbox_status": "queued"}

    async def discard_failed(self, chat_id, message_id, now):
        message = self.failed.pop(message_id, None)
        if message is None or message["chat_id"] != chat_id:
            return None
        return {**message, "outbox_status": "discarded"}

    async def mark_sent(self, job, receipt, now):
        self.sent.append((job, receipt))
        return job["message_id"] in self.scheduled_message_ids

    async def mark_failed(self, job, *, error, attempts, exhausted, now):
        self.failures.append({"job": job, "error": error, "attempts": attempts, "exhausted": exhausted})
        return True, job["message_id"] in self.scheduled_message_ids


class FakeInbox:
    def __init__(self) -> None:
        self.touches: list[tuple[str, str]] = []
        self.unread_candidates: set[str] = set()

    async def touch_human_reply(self, chat_id, at):
        self.touches.append(("human", chat_id))

    async def touch_automated_reply(self, chat_id, at):
        self.touches.append(("bot", chat_id))

    async def touch_last_message(self, chat_id, at):
        self.touches.append(("last_message", chat_id))

    async def mark_read(self, chat_id, at):
        self.touches.append(("read", chat_id))

    async def mark_unread(self, chat_id):
        if chat_id not in self.unread_candidates:
            return False
        self.touches.append(("unread", chat_id))
        return True


class FakeMessages:
    def __init__(self) -> None:
        self.stored: dict[str, dict] = {}
        self.reaction_events: list[dict] = []
        self.reactions: dict[tuple[str, str], dict] = {}
        self.pinned: dict[tuple[str, int], dict] = {}
        self.media: dict[int, str] = {}
        self.payloads: dict[int, dict | None] = {}

    async def insert_provider_message(self, **values):
        existing = self.stored.get(values["wa_message_id"])
        if existing is not None:
            return existing, False
        message = {"id": len(self.stored) + 1, **values}
        self.stored[values["wa_message_id"]] = message
        return message, True

    async def set_media_url(self, message_id, media_url):
        self.media[message_id] = media_url

    async def set_payload(self, message_id, payload):
        self.payloads[message_id] = payload

    async def record_status_event(self, status, *, occurred_at, webhook_event_id):
        return None

    async def record_reaction_event(self, **values):
        if any(event["event_wa_id"] == values["event_wa_id"] for event in self.reaction_events if values["event_wa_id"]):
            return False
        self.reaction_events.append(values)
        return True

    async def apply_reaction(self, chat_id, target_wa_message_id, emoji, *, from_me):
        message = self.reactions.get((chat_id, target_wa_message_id))
        if message is None:
            return None
        message["reactions"] = [{"emoji": emoji, "from_me": from_me}] if emoji else None
        return message

    async def pin(self, chat_id, message_id, user_id, at):
        message = self.pinned.get((chat_id, message_id))
        if message is not None:
            message["pinned_by_user_id"] = user_id
        return message

    async def unpin(self, chat_id, message_id):
        message = self.pinned.get((chat_id, message_id))
        if message is not None:
            message["pinned_by_user_id"] = None
        return message


class FakeScheduled:
    def __init__(self) -> None:
        self.rows: dict[int, dict] = {}
        self.created: list[dict] = []

    async def create(self, lead_id, text, scheduled_at, user_id):
        item = {"id": len(self.created) + 1, "lead_id": lead_id, "text": text, "scheduled_at": scheduled_at,
                "status": ScheduledMessageStatus.SCHEDULED, "created_by_user_id": user_id}
        self.created.append(item)
        self.rows[item["id"]] = dict(item)
        return item

    async def lock(self, scheduled_id):
        row = self.rows.get(scheduled_id)
        return dict(row) if row else None

    async def cancel(self, scheduled_id, now):
        self.rows[scheduled_id]["status"] = ScheduledMessageStatus.CANCELLED

    async def lock_for_dispatch(self, scheduled_id):
        row = await self.lock(scheduled_id)
        return row if row and row["status"] == ScheduledMessageStatus.PROCESSING else None

    async def fail(self, scheduled_id, error, now):
        self.rows[scheduled_id].update(status=ScheduledMessageStatus.FAILED, error=error)

    async def mark_queued(self, scheduled_id, message_id, now):
        self.rows[scheduled_id].update(status=ScheduledMessageStatus.QUEUED, queued_message_id=message_id)

    async def recover_stale(self):
        return None

    async def claim_due(self):
        return []


class FakeContract:
    """Acepta todo salvo los tipos que el test marque como rechazados."""

    def __init__(self) -> None:
        self.rejected_types: set[str] = set()

    async def prepare(self, items):
        prepared = []
        for item in items:
            message = item["message"]
            if message.get("type") in self.rejected_types:
                raise OutboundRejected(f"Meta no acepta {message['type']}")
            reply_to = item.get("reply_to")
            if reply_to:
                message = {**message, "context": {"message_id": reply_to["wa_message_id"]}}
            prepared.append({**item, "message": message, "message_subtype": None})
        return prepared

    def subtype(self, message):
        return None

    def text(self, text):
        return text_item(text)

    def reaction(self, target_wa_message_id, emoji):
        return reaction_message(target_wa_message_id, emoji)


@dataclass
class FakeChannelSender:
    calls: list[tuple[str, dict]] = field(default_factory=list)
    fail_with: Exception | None = None

    async def send(self, chat_id, message):
        if self.fail_with is not None:
            raise self.fail_with
        self.calls.append((chat_id, message))
        return SendReceipt(f"WA-{len(self.calls)}", sent_body={"to": "51999", **message})


@dataclass
class ConversationWorld:
    outbox: FakeOutbox
    inbox: FakeInbox
    messages: FakeMessages
    scheduled: FakeScheduled
    contract: FakeContract
    sender: FakeChannelSender
    windows: dict[str, bool]
    published: list[events.DomainEvent]

    def of(self, event_type) -> list:
        return [event for event in self.published if isinstance(event, event_type)]


class _FakeSession:
    @asynccontextmanager
    async def begin(self):
        yield self

    async def close(self) -> None:
        return None


@pytest.fixture
def in_memory_conversations(monkeypatch) -> ConversationWorld:
    world = ConversationWorld(
        outbox=FakeOutbox(), inbox=FakeInbox(), messages=FakeMessages(), scheduled=FakeScheduled(),
        contract=FakeContract(), sender=FakeChannelSender(), windows={}, published=[],
    )

    async def window(chat_id):
        is_open = world.windows.get(chat_id, True)
        return {"is_open": is_open, "seconds_remaining": 3600 if is_open else 0}

    channel = type("Channel", (), {"sender": world.sender})()
    monkeypatch.setattr(ports, "_ports", ConversationPorts(
        outbox=world.outbox, inbox=world.inbox, messages=world.messages, scheduled=world.scheduled,
        contract=world.contract, service_window=window, channel=lambda: channel,
    ))
    monkeypatch.setattr(uow, "get_sessionmaker", lambda: _FakeSession)

    async def record(pending):
        world.published.extend(pending)

    async def nothing(_events):
        return None

    monkeypatch.setattr(uow, "dispatch_in_transaction", record)
    monkeypatch.setattr(uow, "dispatch_after_commit", nothing)
    return world


def failed_message(world: ConversationWorld, message_id: int, chat_id: str = "lead-1") -> dict:
    message = {"id": message_id, "chat_id": chat_id, "outbox_status": "failed", "sent_at": datetime(2026, 9, 1)}
    world.outbox.failed[message_id] = message
    return message
