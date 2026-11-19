"""Llamadas de WhatsApp de punta a punta contra un PostgreSQL real: el
webhook de Meta, atender, ignorar, colgar y el ciclo de limpieza
(docs/analisis/17-plan-llamadas-whatsapp.md, fase 2)."""

from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text, update

from app.core import events
from app.db.models.control import WebhookInbox
from app.db.models.conversations import WhatsAppCall
from app.db.session import control_session, get_sessionmaker
from app.integrations.whatsapp.channel import CallOutcomeUnknown, ChannelError
from app.modules.conversations.application import calls
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.call_queries import call_offer, chat_calls, ringing_calls
from app.modules.conversations.domain import calls as rules
from app.modules.conversations.domain.events import CallEnded, CallRinging
from app.tenancy.context import tenant_context
from tests.meta_fixtures import webhook_body
from app.integrations.meta_webhook.inbox import CALLS_LANE, claim_events, split_changes, store_changes
from app.integrations.meta_webhook.worker import run_event
from tests.test_meta_webhook_postgres import _with_phone_number_id, fake_media, real_engine, tenant  # noqa: F401
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401

SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\na=setup:actpass\r\n"
ANSWER = "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\na=setup:active\r\n"


async def _deliver(tenant_fixture, body: dict) -> None:
    """Lo mismo que hace el POST de Meta, por el carril de llamadas."""
    _context, phone_number_id, inbox_ids = tenant_fixture
    accepted, _ = await store_changes(split_changes(_with_phone_number_id(body, phone_number_id)))
    inbox_ids.extend(accepted)
    events_claimed = await claim_events(len(accepted) or 1, ids=accepted, lane=CALLS_LANE)
    assert len(events_claimed) == len(accepted)
    for event in events_claimed:
        if not await run_event(event):
            async with control_session() as session:
                error = await session.scalar(select(WebhookInbox.last_error).where(WebhookInbox.id == event.id))
            pytest.fail(f"el evento de llamada falló: {error}")


class FakeCalls:
    def __init__(self):
        self.done: list[tuple] = []
        self.fail: Exception | None = None

    async def accept(self, call_id, sdp, *, pre_accept=False):
        self.done.append(("accept", call_id, pre_accept))
        if self.fail:
            raise self.fail

    async def reject(self, call_id):
        self.done.append(("reject", call_id))

    async def terminate(self, call_id):
        self.done.append(("terminate", call_id))

    async def start(self, chat_id, sdp, *, opaque):
        self.done.append(("start", chat_id, opaque))
        if self.fail:
            raise self.fail
        return self.next_wacid

    next_wacid = "wacid.out"


@pytest.fixture
def meta_calls(monkeypatch):
    control = FakeCalls()
    ports = conversation_ports()
    channel = ports.current_channel()
    monkeypatch.setattr(ports, "channel", lambda: type(channel)(
        name=channel.name, sender=channel.sender, actions=channel.actions, status=channel.status, calls=control,
    ))
    return control


@pytest.fixture
def seen(monkeypatch):
    """Los eventos de llamada que salieron después del commit."""
    collected: list = []

    async def record(event):
        collected.append(event)

    for kind in (CallRinging, CallEnded):
        monkeypatch.setitem(events._handlers, (kind, events.Phase.AFTER_COMMIT), [record])
    return collected


def _wacid() -> str:
    return f"wacid.{secrets.token_hex(8)}"


def _body(call: dict, *, errors: list | None = None) -> dict:
    value = {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "51900000000", "phone_number_id": "x"},
        "contacts": [{"profile": {"name": "Josefina"}, "wa_id": call["from"]}], "calls": [call],
    }
    if errors:
        value["errors"] = errors
    return webhook_body(value, field="calls")


def _connect(wacid: str, phone: str = "51999000111") -> dict:
    return _body({
        "id": wacid, "to": "51900000000", "from": phone, "event": "connect", "direction": "USER_INITIATED",
        "timestamp": str(int(datetime.now(timezone.utc).timestamp())), "session": {"sdp_type": "offer", "sdp": SDP},
    })


def _terminate(wacid: str, phone: str = "51999000111", **extra) -> dict:
    return _body({
        "id": wacid, "to": "51900000000", "from": phone, "event": "terminate", "direction": "USER_INITIATED",
        "timestamp": str(int(datetime.now(timezone.utc).timestamp())), "status": "COMPLETED", **extra,
    }, errors=extra.pop("errors", None) if "errors" in extra else None)


async def _agents(*names: str) -> list[int]:
    ids = []
    async with get_sessionmaker()() as session:
        for name in names:
            ids.append((await session.execute(text(
                "INSERT INTO users (email, name, password_hash, role, is_active, created_at, can_handle_calls) "
                "VALUES (:email, :name, 'x', 'vendedor', true, now(), true) RETURNING id"
            ), {"email": f"{name}-{secrets.token_hex(3)}@example.test", "name": name})).scalar_one())
        await session.commit()
    return ids


async def _call(wacid: str) -> dict:
    return await conversation_ports().calls.get_by_wa_call_id(wacid)


async def test_a_call_rings_is_answered_and_ends_with_its_duration(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))

    with tenant_context(context):
        [ana] = await _agents("Ana")
        row = await _call(wacid)
        assert (row["status"], row["direction"]) == ("ringing", "inbound")
        assert [call["id"] for call in await ringing_calls(ana)] == [row["id"]]
        assert (await ringing_calls(ana))[0]["caller_name"] == "Josefina"
        assert (await call_offer(row["id"]))["sdp"] == SDP

        answered = await calls.answer_call(row["id"], user_id=ana, client_id="tab-1", sdp=ANSWER)
        assert (answered["status"], answered["handled_by_user_id"]) == ("accepted", ana)
        assert meta_calls.done == [("accept", wacid, False)]
        with pytest.raises(rules.CallNoLongerRinging):
            await call_offer(row["id"])

    await _deliver(tenant, _terminate(wacid, duration=95, start_time="1700000000", end_time="1700000095"))

    with tenant_context(context):
        row = await _call(wacid)
        assert (row["status"], row["duration_seconds"], row["remote_sdp"]) == ("completed", 95, None)
        [card] = await chat_calls(row["chat_id"])
        assert (card["status"], card["handled_by_name"], card["duration_seconds"]) == ("completed", "Ana", 95)
    assert [type(event).__name__ for event in seen] == ["CallRinging", "CallEnded"]


async def test_the_offer_never_stays_in_the_inbox_nor_in_the_call_events(tenant, seen) -> None:
    context, _phone, inbox_ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))

    async with control_session() as session:
        payloads = (await session.execute(select(WebhookInbox.payload).where(WebhookInbox.id.in_(inbox_ids)))).scalars().all()
    assert "a=setup" not in str(payloads)
    with tenant_context(context):
        row = await _call(wacid)
        assert "a=setup" not in str(row["events"])
        assert row["remote_sdp"] == SDP


async def test_a_call_nobody_answers_is_missed_with_its_cause(tenant, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))
    with tenant_context(context):
        await _agents("Ana")
        async with get_sessionmaker()() as session:
            await session.execute(update(WhatsAppCall).where(WhatsAppCall.wa_call_id == wacid).values(
                ringing_at=datetime.now(timezone.utc) - timedelta(seconds=40),
            ))
            await session.commit()
    await _deliver(tenant, _terminate(wacid))

    with tenant_context(context):
        row = await _call(wacid)
        assert (row["status"], row["cause"], row["duration_seconds"]) == ("missed", "no_answer", None)
    assert seen[-1].status == "missed"


async def test_events_can_arrive_twice_and_out_of_order(tenant, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    # Meta avisa que puede mandar el fin antes que el principio.
    await _deliver(tenant, _terminate(wacid, duration=10, start_time="1700000000", end_time="1700000010"))
    await _deliver(tenant, _connect(wacid))
    await _deliver(tenant, _terminate(wacid, duration=10, start_time="1700000000", end_time="1700000010", biz="dup"))

    with tenant_context(context):
        row = await _call(wacid)
        assert (row["status"], row["duration_seconds"]) == ("completed", 10)
        async with get_sessionmaker()() as session:
            total = await session.scalar(text("SELECT count(*) FROM whatsapp_calls WHERE wa_call_id = :id"), {"id": wacid})
        assert total == 1
    # Un solo cierre anunciado y ningún timbre para una llamada ya terminada.
    assert [type(event).__name__ for event in seen] == ["CallEnded"]


async def test_a_meta_error_becomes_a_failed_call_with_its_cause(tenant, seen) -> None:
    context, _phone, _ids = tenant
    wacid, unknown = _wacid(), _wacid()
    await _deliver(tenant, _connect(wacid))
    await _deliver(tenant, _terminate(wacid, errors=[{"code": 138021, "message": "Media receive timeout"}]))
    await _deliver(tenant, _connect(unknown, phone="51999000222"))
    await _deliver(tenant, _terminate(unknown, phone="51999000222", errors=[{"code": 139999}]))

    with tenant_context(context):
        row = await _call(wacid)
        assert (row["status"], row["cause"], row["error_code"]) == ("failed", "no_audio", "138021")
        other = await _call(unknown)
        assert (other["cause"], other["error_code"]) == ("other", "139999")


async def test_only_one_of_two_people_answers(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))
    with tenant_context(context):
        ana, bea = await _agents("Ana", "Bea")
        row = await _call(wacid)
        results = await asyncio.gather(
            calls.answer_call(row["id"], user_id=ana, client_id="a", sdp=ANSWER),
            calls.answer_call(row["id"], user_id=bea, client_id="b", sdp=ANSWER),
            return_exceptions=True,
        )
        won = [result for result in results if isinstance(result, dict)]
        lost = [result for result in results if isinstance(result, rules.CallNoLongerRinging)]
        assert (len(won), len(lost)) == (1, 1)
        assert len(meta_calls.done) == 1


async def test_a_person_cannot_hold_two_live_calls(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    first, second = _wacid(), _wacid()
    await _deliver(tenant, _connect(first))
    await _deliver(tenant, _connect(second, phone="51999000222"))
    with tenant_context(context):
        [ana] = await _agents("Ana")
        await calls.answer_call((await _call(first))["id"], user_id=ana, client_id="a", sdp=ANSWER)
        with pytest.raises(rules.AgentBusy):
            await calls.answer_call((await _call(second))["id"], user_id=ana, client_id="a", sdp=ANSWER)
        assert (await _call(second))["status"] == "ringing"


async def test_a_clear_rejection_from_meta_makes_it_ring_again(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))
    with tenant_context(context):
        [ana] = await _agents("Ana")
        row = await _call(wacid)
        meta_calls.fail = ChannelError("call already ended", status_code=400)
        with pytest.raises(rules.CallNoLongerRinging):
            await calls.answer_call(row["id"], user_id=ana, client_id="a", sdp=ANSWER)
        row = await _call(wacid)
        assert (row["status"], row["handled_by_user_id"]) == ("ringing", None)


async def test_when_meta_does_not_answer_the_call_is_not_released(tenant, meta_calls, seen) -> None:
    """Meta pudo haberla conectado: soltarla dejaría que otra persona atienda
    una llamada que ya está en curso."""
    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))
    with tenant_context(context):
        ana, bea = await _agents("Ana", "Bea")
        row = await _call(wacid)
        meta_calls.fail = CallOutcomeUnknown("timeout")
        pending = await calls.answer_call(row["id"], user_id=ana, client_id="a", sdp=ANSWER)
        assert (pending["status"], pending["handled_by_user_id"]) == ("connecting", ana)
        with pytest.raises(rules.CallNoLongerRinging):
            await calls.answer_call(row["id"], user_id=bea, client_id="b", sdp=ANSWER)

        # El navegador de Ana oye al cliente y lo confirma.
        with pytest.raises(rules.CallNotYours):
            await calls.confirm_call_connected(row["id"], user_id=bea)
        confirmed = await calls.confirm_call_connected(row["id"], user_id=ana)
        assert confirmed["status"] == "accepted"


async def test_ignoring_stops_the_ring_for_that_person_only(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))
    with tenant_context(context):
        ana, bea = await _agents("Ana", "Bea")
        row = await _call(wacid)
        await calls.dismiss_call(row["id"], user_id=ana)
        assert await ringing_calls(ana) == []
        assert len(await ringing_calls(bea)) == 1
        assert meta_calls.done == []

        # Cuando ya la ignoraron todos, se rechaza para que el cliente no espere.
        await calls.dismiss_call(row["id"], user_id=bea)
        assert meta_calls.done == [("reject", wacid)]


async def test_only_who_answers_or_an_admin_hangs_up(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))
    with tenant_context(context):
        ana, bea = await _agents("Ana", "Bea")
        row = await _call(wacid)
        await calls.answer_call(row["id"], user_id=ana, client_id="a", sdp=ANSWER)
        with pytest.raises(rules.CallNotYours):
            await calls.hang_up(row["id"], user_id=bea, is_admin=False)
        ended = await calls.hang_up(row["id"], user_id=ana, is_admin=False, cause="dropped")
        assert (ended["status"], ended["cause"]) == ("failed", "dropped")
        assert ("terminate", wacid) in meta_calls.done

    # El cierre de Meta llega después y corrige con la duración real, sin
    # perder lo que informó el navegador.
    await _deliver(tenant, _terminate(wacid, duration=42, start_time="1700000000", end_time="1700000042"))
    with tenant_context(context):
        row = await _call(wacid)
        assert (row["status"], row["duration_seconds"], row["cause"], row["closed_by"]) == ("completed", 42, "dropped", None)


async def test_the_sweep_closes_what_meta_never_closed(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    old, unconfirmed, fresh = _wacid(), _wacid(), _wacid()
    await _deliver(tenant, _connect(old))
    await _deliver(tenant, _connect(unconfirmed, phone="51999000222"))
    await _deliver(tenant, _connect(fresh, phone="51999000333"))
    with tenant_context(context):
        [ana] = await _agents("Ana")
        meta_calls.fail = CallOutcomeUnknown("timeout")
        await calls.answer_call((await _call(unconfirmed))["id"], user_id=ana, client_id="a", sdp=ANSWER)
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        async with get_sessionmaker()() as session:
            await session.execute(update(WhatsAppCall).where(WhatsAppCall.wa_call_id == old).values(ringing_at=past))
            await session.execute(update(WhatsAppCall).where(WhatsAppCall.wa_call_id == unconfirmed).values(claim_expires_at=past))
            await session.commit()

        assert await calls.reap_calls() == 2

        assert ((await _call(old))["status"], (await _call(old))["cause"]) == ("missed", "closed_without_meta")
        row = await _call(unconfirmed)
        assert (row["status"], row["cause"], row["closed_by"]) == ("failed", "unconfirmed", "reaper")
        assert ("terminate", unconfirmed) in meta_calls.done
        assert (await _call(fresh))["status"] == "ringing"


async def test_a_connect_that_arrives_late_does_not_ring(tenant, seen) -> None:
    context, _phone, _ids = tenant
    wacid = _wacid()
    with tenant_context(context):
        async with get_sessionmaker()() as session:
            chat_id = (await session.execute(text("INSERT INTO leads (telefono) VALUES ('51999000444') RETURNING id"))).scalar_one()
            await session.commit()
        row = await calls.receive_call(
            chat_id=str(chat_id), wa_call_id=wacid, phone_number_id="x", sdp=SDP, occurred_at=None,
            received_at=datetime.now(timezone.utc) - timedelta(seconds=90), event={"id": wacid},
        )
        assert (row["status"], row["cause"]) == ("missed", "late_notice")
    assert [type(event).__name__ for event in seen] == ["CallEnded"]


async def _notifications(call_id: int) -> list[tuple[int, str, str]]:
    async with get_sessionmaker()() as session:
        rows = await session.execute(text(
            "SELECT user_id, notification_type, body FROM user_notifications WHERE source_id = :id ORDER BY user_id"
        ), {"id": str(call_id)})
        return [tuple(row) for row in rows]


async def test_a_missed_call_is_left_in_the_bell_of_everyone_who_answers(tenant, meta_calls, seen) -> None:
    context, _phone, _ids = tenant
    missed, answered = _wacid(), _wacid()
    with tenant_context(context):
        ana, bea = await _agents("Ana", "Bea")
    await _deliver(tenant, _connect(missed))
    await _deliver(tenant, _terminate(missed))
    # Un aviso repetido de Meta no deja una segunda notificación.
    await _deliver(tenant, _terminate(missed, biz="dup"))

    await _deliver(tenant, _connect(answered, phone="51999000222"))
    with tenant_context(context):
        row = await _call(answered)
        await calls.answer_call(row["id"], user_id=ana, client_id="a", sdp=ANSWER)
    await _deliver(tenant, _terminate(answered, phone="51999000222", duration=30, start_time="1700000000", end_time="1700000030"))

    with tenant_context(context):
        missed_id = (await _call(missed))["id"]
        assert await _notifications(missed_id) == [
            (ana, "missed_call", "De Josefina"), (bea, "missed_call", "De Josefina"),
        ]
        assert await _notifications((await _call(answered))["id"]) == []


async def test_a_missed_call_leaves_the_chat_unread_until_someone_opens_it(tenant, meta_calls, seen) -> None:
    from app.modules.conversations.application.inbox import mark_read
    from app.modules.conversations.chat_queries import fetch_chat
    from app.modules.conversations.inbox_queries import fetch_total_unread_chat_count

    context, _phone, _ids = tenant
    wacid = _wacid()
    await _deliver(tenant, _connect(wacid))
    with tenant_context(context):
        chat_id = (await _call(wacid))["chat_id"]
        # Mientras suena no es "sin leer": todavía puede atenderse.
        assert (await fetch_chat(chat_id))["unread_count"] == 0
    await _deliver(tenant, _terminate(wacid))

    with tenant_context(context):
        assert (await fetch_chat(chat_id))["unread_count"] == 1
        assert await fetch_total_unread_chat_count() == 1
        await mark_read(chat_id)
        assert (await fetch_chat(chat_id))["unread_count"] == 0
        assert await fetch_total_unread_chat_count() == 0


# --- Llamar al cliente (fase 3) -------------------------------------------

from app.integrations.whatsapp.channel import CallRefused  # noqa: E402
from app.modules.conversations.call_queries import call_answer  # noqa: E402


async def _lead(phone: str = "51999000555") -> str:
    async with get_sessionmaker()() as session:
        chat_id = (await session.execute(text("INSERT INTO leads (telefono) VALUES (:p) RETURNING id"), {"p": phone})).scalar_one()
        await session.commit()
    return str(chat_id)


def _outbound(wacid: str, event: str, opaque: str | None = None, **extra) -> dict:
    call = {
        "id": wacid, "to": "51999000555", "from": "51900000000", "event": event, "direction": "BUSINESS_INITIATED",
        "timestamp": str(int(datetime.now(timezone.utc).timestamp())), **extra,
    }
    if opaque:
        call["biz_opaque_callback_data"] = opaque
    return _body(call)


def _status(wacid: str, status: str, opaque: str | None = None) -> dict:
    item = {"id": wacid, "type": "call", "status": status, "timestamp": str(int(datetime.now(timezone.utc).timestamp())), "recipient_id": "51999000555"}
    if opaque:
        item["biz_opaque_callback_data"] = opaque
    return webhook_body({
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "51900000000", "phone_number_id": "x"},
        "statuses": [item],
    }, field="calls")


async def test_an_agent_calls_a_customer_who_answers(tenant, meta_calls, seen) -> None:
    context, phone_number_id, _ids = tenant
    wacid = _wacid()
    meta_calls.next_wacid = wacid
    with tenant_context(context):
        [ana] = await _agents("Ana")
        chat_id = await _lead()
        row = await calls.start_call(chat_id, user_id=ana, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)
        assert (row["status"], row["direction"], row["handled_by_user_id"]) == ("dialing", "outbound", ana)
        assert meta_calls.done == [("start", chat_id, str(row["id"]))]
        assert (await call_answer(row["id"], ana))["sdp"] is None

    await _deliver(tenant, _status(wacid, "RINGING"))
    await _deliver(tenant, _outbound(wacid, "connect", session={"sdp_type": "answer", "sdp": ANSWER}))
    await _deliver(tenant, _status(wacid, "ACCEPTED"))
    # Un "sonando" que llega tarde no la devuelve atrás.
    await _deliver(tenant, _status(wacid, "RINGING", opaque="late"))

    with tenant_context(context):
        state = await call_answer(row["id"], ana)
        assert (state["call"]["status"], state["sdp"]) == ("accepted", ANSWER)
        with pytest.raises(rules.CallNotYours):
            await call_answer(row["id"], ana + 999)

    await _deliver(tenant, _outbound(wacid, "terminate", duration=61, start_time="1700000000", end_time="1700000061"))
    with tenant_context(context):
        final = await _call(wacid)
        assert (final["status"], final["duration_seconds"], final["remote_sdp"]) == ("completed", 61, None)
        # Una saliente nunca deja "llamada perdida" en la campanita.
        assert await _notifications(final["id"]) == []


async def test_events_that_arrive_before_the_call_id_is_stored_are_linked_by_our_id(tenant, meta_calls, seen) -> None:
    context, phone_number_id, _ids = tenant
    wacid = _wacid()
    with tenant_context(context):
        [ana] = await _agents("Ana")
        chat_id = await _lead()
        # Meta no confirmó el inicio: la llamada queda sin su id de Meta.
        meta_calls.fail = CallOutcomeUnknown("timeout")
        row = await calls.start_call(chat_id, user_id=ana, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)
        assert row.get("wa_call_id") is None

    await _deliver(tenant, _status(wacid, "RINGING", opaque=str(row["id"])))

    with tenant_context(context):
        linked = await conversation_ports().calls.get(row["id"])
        assert (linked["wa_call_id"], linked["status"]) == (wacid, "ringing")
        async with get_sessionmaker()() as session:
            assert await session.scalar(text("SELECT count(*) FROM whatsapp_calls")) == 1


async def test_an_unknown_outbound_call_never_creates_a_row(tenant, meta_calls, seen) -> None:
    context, _phone, inbox_ids = tenant
    accepted, _ = await store_changes(split_changes(_with_phone_number_id(_status(_wacid(), "RINGING"), tenant[1])))
    inbox_ids.extend(accepted)
    [event] = await claim_events(1, ids=accepted, lane=CALLS_LANE)

    # Falla para reintentarse: todavía puede guardarse el id de esa llamada.
    assert await run_event(event) is False
    with tenant_context(context):
        async with get_sessionmaker()() as session:
            assert await session.scalar(text("SELECT count(*) FROM whatsapp_calls")) == 0


async def test_a_call_meta_refuses_is_recorded_with_its_cause(tenant, meta_calls, seen) -> None:
    context, phone_number_id, _ids = tenant
    with tenant_context(context):
        [ana] = await _agents("Ana")
        chat_id = await _lead()
        meta_calls.fail = CallRefused("No approved call permission", code="138006", status_code=400)
        with pytest.raises(rules.CallNotAllowed) as refused:
            await calls.start_call(chat_id, user_id=ana, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)
        assert refused.value.cause == "no_permission"
        [card] = await chat_calls(chat_id)
        assert (card["status"], card["cause"], card["error_code"]) == ("failed", "no_permission", "138006")
        # Y no deja a la persona "ocupada": puede volver a llamar.
        meta_calls.fail = None
        await calls.start_call(chat_id, user_id=ana, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)


async def test_only_one_live_call_per_customer_and_per_agent(tenant, meta_calls, seen) -> None:
    context, phone_number_id, _ids = tenant
    with tenant_context(context):
        ana, bea = await _agents("Ana", "Bea")
        first, second = await _lead(), await _lead("51999000666")
        await calls.start_call(first, user_id=ana, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)
        with pytest.raises(rules.CallInProgress):
            await calls.start_call(first, user_id=bea, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)
        with pytest.raises(rules.AgentBusy):
            await calls.start_call(second, user_id=ana, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)


async def test_a_customer_who_rejects_or_does_not_answer(tenant, meta_calls, seen) -> None:
    context, phone_number_id, _ids = tenant
    rejected, unanswered = _wacid(), _wacid()
    with tenant_context(context):
        ana, bea = await _agents("Ana", "Bea")
        meta_calls.next_wacid = rejected
        await calls.start_call(await _lead(), user_id=ana, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)
        meta_calls.next_wacid = unanswered
        await calls.start_call(await _lead("51999000666"), user_id=bea, client_id="tab", sdp=SDP, phone_number_id=phone_number_id)

    await _deliver(tenant, _status(rejected, "REJECTED"))
    await _deliver(tenant, _outbound(unanswered, "terminate"))

    with tenant_context(context):
        assert ((await _call(rejected))["status"], (await _call(rejected))["cause"]) == ("rejected", "customer_rejected")
        assert ((await _call(unanswered))["status"], (await _call(unanswered))["cause"]) == ("failed", "customer_no_answer")


def test_the_permission_summary_reads_limits_from_meta():
    summary = calls.permission_summary({
        "permission": {"status": "temporary", "expiration_time": 1745343479},
        "actions": [
            {"action_name": "send_call_permission_request", "can_perform_action": False},
            {"action_name": "start_call", "can_perform_action": True},
        ],
    })
    assert (summary["status"], summary["can_call"], summary["can_request"]) == ("temporary", True, False)
    assert summary["expires_at"].year == 2025
    assert calls.permission_summary({"permission": {"status": "no_permission"}}) == {
        "status": "none", "expires_at": None, "can_call": False, "can_request": False,
    }
