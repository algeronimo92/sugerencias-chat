import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from db.models import WspMessage
from services import message_outbox, meta_service, whatsapp_channel
from services.media_storage import MediaNotFoundError
from services.message_outbox import SendOutcome, classify_send_failure, is_final_failure
from services.meta_service import MetaApiError, WhatsAppWindowClosedError
from services.outbound_kinds import OutboundDelivery
from services.whatsapp_channel import ChannelError, DeliveryUnconfirmedError, SendReceipt


DELIVERY = OutboundDelivery(SendReceipt("WA-1"))
QUICK_DELIVERY = OutboundDelivery(SendReceipt("WA-QUICK"))


def _job(**overrides):
    return {
        "id": 10,
        "message_id": 20,
        "chat_id": "lead-1",
        "attempts": 0,
        "payload": {"type": "text", "text": "Hola"},
        **overrides,
    }


@pytest.mark.parametrize(("exc", "expected"), [
    (DeliveryUnconfirmedError("sin respuesta"), SendOutcome.UNCONFIRMED),
    (WhatsAppWindowClosedError("ventana cerrada", status_code=400), SendOutcome.DEFINITIVE),
    (MetaApiError("parámetro inválido", status_code=400), SendOutcome.DEFINITIVE),
    (MetaApiError("token vencido", status_code=401), SendOutcome.DEFINITIVE),
    (MetaApiError("sin configurar"), SendOutcome.DEFINITIVE),
    (MetaApiError("demasiadas solicitudes", status_code=429), SendOutcome.RETRYABLE),
    (MetaApiError("error interno", status_code=503), SendOutcome.RETRYABLE),
    (MediaNotFoundError("no existe"), SendOutcome.DEFINITIVE),
    (ChannelError("rechazo de otro proveedor", status_code=400), SendOutcome.DEFINITIVE),
    (httpx.ConnectError("sin red"), SendOutcome.RETRYABLE),
    (RuntimeError("minio caído"), SendOutcome.RETRYABLE),
])
def test_send_failures_are_classified_by_whether_a_retry_can_duplicate(exc, expected):
    assert classify_send_failure(exc) is expected


def test_only_retryable_failures_get_more_attempts():
    assert is_final_failure(1, SendOutcome.RETRYABLE) is False
    assert is_final_failure(message_outbox.MAX_ATTEMPTS, SendOutcome.RETRYABLE) is True
    assert is_final_failure(1, SendOutcome.DEFINITIVE) is True
    assert is_final_failure(1, SendOutcome.UNCONFIRMED) is True


@pytest.mark.parametrize("transport_error", [
    httpx.ReadTimeout("timeout"),
    httpx.RemoteProtocolError("desconectado"),
    ValueError("json inválido"),
])
async def test_meta_send_without_readable_answer_is_unconfirmed(monkeypatch, transport_error):
    monkeypatch.setattr(meta_service, "_request", AsyncMock(side_effect=transport_error))

    with pytest.raises(DeliveryUnconfirmedError):
        await meta_service._send("lead-1", "token", "PHONE1", {"to": "51999"}, timeout=30.0)


async def test_meta_send_that_never_connected_keeps_the_transport_error(monkeypatch):
    monkeypatch.setattr(meta_service, "_request", AsyncMock(side_effect=httpx.ConnectError("sin red")))

    with pytest.raises(httpx.ConnectError):
        await meta_service._send("lead-1", "token", "PHONE1", {"to": "51999"}, timeout=30.0)


def test_unconfirmed_delivery_is_explained_to_the_seller():
    exc = DeliveryUnconfirmedError()

    assert whatsapp_channel.describe_send_failure(exc, "enviar") == whatsapp_channel.UNCONFIRMED_DELIVERY_MESSAGE


async def test_accepted_message_is_never_requeued_when_recording_it_fails(monkeypatch):
    monkeypatch.setattr(message_outbox, "RECORD_SENT_RETRY_DELAYS", (0, 0, 0))
    monkeypatch.setattr(message_outbox, "send_outbound", AsyncMock(return_value=DELIVERY))
    record = AsyncMock(side_effect=[RuntimeError("db"), RuntimeError("db"), False])
    announce = AsyncMock()
    mark_failed = AsyncMock()
    monkeypatch.setattr(message_outbox, "_record_sent", record)
    monkeypatch.setattr(message_outbox, "_announce_sent", announce)
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    await message_outbox._process_job(_job())

    assert record.await_count == 3
    announce.assert_awaited_once()
    mark_failed.assert_not_awaited()


async def test_accepted_message_stays_out_of_retry_even_if_it_never_gets_recorded(monkeypatch):
    monkeypatch.setattr(message_outbox, "RECORD_SENT_RETRY_DELAYS", (0, 0))
    monkeypatch.setattr(message_outbox, "send_outbound", AsyncMock(return_value=DELIVERY))
    monkeypatch.setattr(message_outbox, "_record_sent", AsyncMock(side_effect=RuntimeError("db")))
    mark_failed = AsyncMock()
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    await message_outbox._process_job(_job())

    mark_failed.assert_not_awaited()


async def test_failed_send_is_recorded_with_its_outcome(monkeypatch):
    exc = DeliveryUnconfirmedError("sin respuesta")
    monkeypatch.setattr(message_outbox, "send_outbound", AsyncMock(side_effect=exc))
    mark_failed = AsyncMock()
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    await message_outbox._process_job(_job())

    mark_failed.assert_awaited_once_with(_job(), exc, SendOutcome.UNCONFIRMED)


async def test_shutdown_lets_quick_sends_finish_and_marks_stuck_ones_unconfirmed(monkeypatch):
    monkeypatch.setattr(message_outbox, "SHUTDOWN_GRACE_SECONDS", 0.05)
    release_quick = asyncio.Event()

    async def send(_sender, chat_id, payload):
        if payload["text"] == "rápido":
            await release_quick.wait()
            return QUICK_DELIVERY
        await asyncio.Event().wait()

    persist = AsyncMock(return_value=True)
    mark_failed = AsyncMock()
    monkeypatch.setattr(message_outbox, "send_outbound", send)
    monkeypatch.setattr(message_outbox, "_persist_sent", persist)
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    quick = _job(id=1, message_id=1, payload={"type": "text", "text": "rápido"})
    stuck = _job(id=2, message_id=2, payload={"type": "text", "text": "colgado"})
    worker = asyncio.create_task(message_outbox._process_batch([quick, stuck]))
    await asyncio.sleep(0)
    worker.cancel()
    await asyncio.sleep(0)
    release_quick.set()

    with pytest.raises(asyncio.CancelledError):
        await worker

    persist.assert_awaited_once_with(quick, QUICK_DELIVERY)
    mark_failed.assert_awaited_once()
    failed_job, failed_exc, outcome = mark_failed.await_args.args
    assert failed_job == stuck
    assert isinstance(failed_exc, DeliveryUnconfirmedError)
    assert outcome is SendOutcome.UNCONFIRMED


async def test_stale_processing_jobs_are_marked_unconfirmed_instead_of_resent(monkeypatch):
    stale = {"id": 3, "message_id": 30, "chat_id": "lead-1", "payload": {"type": "text"}, "attempts": 0}
    session = AsyncMock()
    session.execute = AsyncMock(return_value=SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: [stale])))

    class _Context:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(message_outbox, "get_sessionmaker", lambda: _Context)
    mark_failed = AsyncMock()
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    await message_outbox._recover_stale_jobs()

    failed_job, failed_exc, outcome = mark_failed.await_args.args
    assert failed_job == stale
    assert isinstance(failed_exc, DeliveryUnconfirmedError)
    assert outcome is SendOutcome.UNCONFIRMED


async def test_enqueue_with_known_dedupe_key_returns_the_existing_message(monkeypatch):
    existing = WspMessage(
        id=55, chat_id="lead-1", sender="vendedor", content="Hola",
        sent_at=datetime(2026, 9, 15, tzinfo=timezone.utc), status="PENDING", message_type="text",
    )
    session = AsyncMock()
    session.add = lambda _obj: pytest.fail("no debe insertar un mensaje ya encolado")
    session.execute = AsyncMock(return_value=SimpleNamespace(all=lambda: [("automation:1:1:0:0", existing)]))

    class _Context:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(message_outbox, "get_sessionmaker", lambda: _Context)

    sent = await message_outbox.enqueue_messages("lead-1", [{
        "content": "Hola",
        "payload": {"type": "text", "text": "Hola"},
        "dedupe_key": "automation:1:1:0:0",
    }])

    assert [message["id"] for message in sent] == [55]
    session.commit.assert_not_awaited()
