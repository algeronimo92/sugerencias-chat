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
from services.whatsapp_channel import ChannelError, DeliveryUnconfirmedError, SendReceipt
from services.whatsapp_identity_service import Destination
from tests.conftest import FakeSender, install_channel


def _text(body: str) -> dict:
    return {"type": "text", "text": {"body": body}}


def _receipt(message_id: str, body: str = "Hola") -> SendReceipt:
    return SendReceipt(message_id, sent_body={"to": "51999", "messaging_product": "whatsapp", **_text(body)})


DELIVERY = _receipt("WA-1")
QUICK_DELIVERY = _receipt("WA-QUICK", "rápido")


def _job(**overrides):
    return {
        "id": 10,
        "message_id": 20,
        "chat_id": "lead-1",
        "attempts": 0,
        "payload": {"message": _text("Hola")},
        **overrides,
    }


class _ScriptedSender(FakeSender):
    """Devuelve o lanza lo que el test indique en cada envío."""

    def __init__(self, handler):
        super().__init__()
        self.handler = handler

    async def send(self, chat_id, message):
        self.calls.append((chat_id, message))
        return await self.handler(chat_id, message)


def _install_sender(monkeypatch, handler):
    install_channel(monkeypatch, sender=_ScriptedSender(handler))
    monkeypatch.setattr(message_outbox, "require_capabilities", AsyncMock())


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


def _mock_meta_send(monkeypatch, error):
    monkeypatch.setattr(meta_service, "_config", AsyncMock(return_value=("token", "PHONE1", "WABA1")))
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination", AsyncMock(return_value=Destination("51999", None)),
    )
    monkeypatch.setattr(meta_service, "_request", AsyncMock(side_effect=error))


@pytest.mark.parametrize("transport_error", [
    httpx.ReadTimeout("timeout"),
    httpx.RemoteProtocolError("desconectado"),
    ValueError("json inválido"),
])
async def test_meta_send_without_readable_answer_is_unconfirmed(monkeypatch, transport_error):
    _mock_meta_send(monkeypatch, transport_error)

    with pytest.raises(DeliveryUnconfirmedError):
        await meta_service.send_message("lead-1", _text("Hola"))


async def test_meta_send_that_never_connected_keeps_the_transport_error(monkeypatch):
    _mock_meta_send(monkeypatch, httpx.ConnectError("sin red"))

    with pytest.raises(httpx.ConnectError):
        await meta_service.send_message("lead-1", _text("Hola"))


def test_unconfirmed_delivery_is_explained_to_the_seller():
    exc = DeliveryUnconfirmedError()

    assert whatsapp_channel.describe_send_failure(exc, "enviar") == whatsapp_channel.UNCONFIRMED_DELIVERY_MESSAGE


async def test_accepted_message_is_never_requeued_when_recording_it_fails(monkeypatch):
    monkeypatch.setattr(message_outbox, "RECORD_SENT_RETRY_DELAYS", (0, 0, 0))
    _install_sender(monkeypatch, AsyncMock(return_value=DELIVERY))
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
    _install_sender(monkeypatch, AsyncMock(return_value=DELIVERY))
    monkeypatch.setattr(message_outbox, "_record_sent", AsyncMock(side_effect=RuntimeError("db")))
    mark_failed = AsyncMock()
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    await message_outbox._process_job(_job())

    mark_failed.assert_not_awaited()


async def test_failed_send_is_recorded_with_its_outcome(monkeypatch):
    exc = DeliveryUnconfirmedError("sin respuesta")
    _install_sender(monkeypatch, AsyncMock(side_effect=exc))
    mark_failed = AsyncMock()
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    await message_outbox._process_job(_job())

    mark_failed.assert_awaited_once_with(_job(), exc, SendOutcome.UNCONFIRMED)


async def test_shutdown_lets_quick_sends_finish_and_marks_stuck_ones_unconfirmed(monkeypatch):
    monkeypatch.setattr(message_outbox, "SHUTDOWN_GRACE_SECONDS", 0.05)
    release_quick = asyncio.Event()

    async def send(chat_id, message):
        if message["text"]["body"] == "rápido":
            await release_quick.wait()
            return QUICK_DELIVERY
        await asyncio.Event().wait()

    persist = AsyncMock(return_value=True)
    mark_failed = AsyncMock()
    _install_sender(monkeypatch, send)
    monkeypatch.setattr(message_outbox, "_persist_sent", persist)
    monkeypatch.setattr(message_outbox, "_mark_failed", mark_failed)

    quick = _job(id=1, message_id=1, payload={"message": _text("rápido")})
    stuck = _job(id=2, message_id=2, payload={"message": _text("colgado")})
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
    stale = {"id": 3, "message_id": 30, "chat_id": "lead-1", "payload": {"message": _text("x")}, "attempts": 0}
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
        sent_at=datetime(2026, 9, 15, tzinfo=timezone.utc), outbox_status="queued", message_type="text",
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
    monkeypatch.setattr(message_outbox, "require_capabilities", AsyncMock())

    sent = await message_outbox.enqueue_messages("lead-1", [{
        "content": "Hola",
        "message": _text("Hola"),
        "dedupe_key": "automation:1:1:0:0",
    }])

    assert [message["id"] for message in sent] == [55]
    session.commit.assert_not_awaited()
