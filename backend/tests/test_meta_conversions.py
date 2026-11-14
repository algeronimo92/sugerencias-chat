"""Eventos de conversión a Meta con dobles: claves, payload, traducción de
errores, partición del lote y cuándo no se encola nada.
Diseño: docs/analisis/14-diseno-api-conversiones-meta-ctwa.md §6."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.modules.leads import subscribers
from app.modules.leads.attribution import commands, worker
from app.modules.leads.attribution import events as conversions
from app.modules.leads.attribution.ports import ConversionSendError
from app.modules.leads.domain.events import LeadAppointmentScheduled
from app.modules.leads.domain.lead import Actor

NOW = datetime(2026, 11, 13, 15, 0, tzinfo=timezone.utc)


def test_each_fact_has_its_dedupe_key():
    assert conversions.lead_submitted_key("L") == "L:LeadSubmitted"
    assert conversions.qualified_lead_key("L") == "L:QualifiedLead"
    assert conversions.purchase_key("L", 41) == "L:Purchase:41"


def test_the_payload_carries_only_the_click_the_waba_and_the_amount():
    event = conversions.payload(
        event_name="Purchase", event_time=NOW, waba_id="W", ctwa_clid="C",
        custom_data={"currency": "PEN", "value": 450.0, "content_name": "no debe viajar"},
    )
    assert event == {
        "event_name": "Purchase",
        "event_time": 1794582000,
        "action_source": "business_messaging",
        "messaging_channel": "whatsapp",
        "user_data": {"whatsapp_business_account_id": "W", "ctwa_clid": "C"},
        "custom_data": {"currency": "PEN", "value": 450.0},
    }
    assert "custom_data" not in conversions.payload(
        event_name="QualifiedLead", event_time=NOW, waba_id="W", ctwa_clid="C", custom_data=None,
    )


def test_purchase_amount_is_rounded_to_cents():
    assert conversions.purchase_data("80.505", "PEN") == {"currency": "PEN", "value": 80.51}


@pytest.mark.parametrize(("status_code", "code", "subcode", "kind"), [
    (400, 190, None, "token"),
    (400, 100, 2804066, "failed"),
    (400, 100, 2804081, "failed"),
    (400, 100, 2804131, "failed"),
    (429, 4, None, "retry"),
    (503, 2, None, "retry"),
    (None, None, None, "retry"),
    (400, 100, None, "failed"),
])
def test_meta_errors_translate_to_retry_failure_or_alert(status_code, code, subcode, kind):
    assert conversions.classify(status_code=status_code, code=code, subcode=subcode).kind == kind


def test_retries_follow_the_outbox_ladder():
    assert [conversions.next_attempt(n, NOW) - NOW for n in (1, 2, 3, 4, 5, 9)] == [
        timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=30),
        timedelta(hours=2), timedelta(hours=6), timedelta(hours=6),
    ]


# --- Worker: qué pasa con cada respuesta de Meta ---------------------------

def _row(event_id: int, *, name="QualifiedLead", event_time=NOW, attempts=0, custom_data=None) -> dict:
    return {
        "id": event_id, "lead_id": f"lead-{event_id}", "event_name": name, "event_time": event_time,
        "custom_data": custom_data, "attempts": attempts, "ctwaclid": f"clid-{event_id}",
    }


class FakeSender:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[list[dict]] = []

    async def send(self, dataset_id, events, test_event_code):
        self.calls.append(events)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


@pytest.fixture
def recorded(monkeypatch):
    calls = {"mark": {}, "activity": [], "alerts": []}

    async def mark(event_id, **values):
        calls["mark"].setdefault(event_id, {}).update(values)

    async def activity(lead_id, *, event, amount):
        calls["activity"].append((lead_id, event, amount))

    async def alert(**values):
        calls["alerts"].append(values["event_key"])

    monkeypatch.setattr(worker.repository, "mark", mark)
    monkeypatch.setattr(worker, "record_conversion_activity", activity)
    monkeypatch.setattr(worker, "try_send_operational_alert", alert)
    return calls


async def _send(rows, sender):
    await worker._send(rows, sender, dataset_id="D", waba_id="W", test_code=None, now=NOW)


async def test_a_batch_meta_fully_received_is_sent_and_left_in_the_history(recorded):
    sender = FakeSender({"events_received": 2, "fbtrace_id": "T"})
    rows = [_row(1), _row(2, name="Purchase", custom_data={"currency": "PEN", "value": 80.0})]

    await _send(rows, sender)

    assert len(sender.calls) == 1 and len(sender.calls[0]) == 2
    assert {recorded["mark"][i]["status"] for i in (1, 2)} == {"sent"}
    assert recorded["mark"][1]["meta_trace_id"] == "T"
    assert ("lead-2", "Compra (adelanto de la cita)", "80.00 PEN") in recorded["activity"]


async def test_a_short_events_received_splits_the_batch_one_by_one(recorded):
    sender = FakeSender(
        {"events_received": 1},
        {"events_received": 1},
        {"events_received": 0},
    )

    await _send([_row(1), _row(2)], sender)

    assert [len(call) for call in sender.calls] == [2, 1, 1]
    assert recorded["mark"][1]["status"] == "sent"
    assert "status" not in recorded["mark"][2]  # sigue pendiente, con reintento
    assert recorded["mark"][2]["next_attempt_at"] == NOW + timedelta(minutes=1)


async def test_an_invalid_event_is_isolated_and_the_rest_still_go(recorded):
    invalid = ConversionSendError("evento inválido", status_code=400, code=100, subcode=2804066)
    sender = FakeSender(invalid, {"events_received": 1}, invalid)

    await _send([_row(1), _row(2)], sender)

    assert recorded["mark"][1]["status"] == "sent"
    assert recorded["mark"][2]["status"] == "failed"


async def test_a_rejected_token_fails_the_batch_and_alerts_the_operator(recorded):
    sender = FakeSender(ConversionSendError("token", status_code=400, code=190))

    await _send([_row(1), _row(2)], sender)

    assert {recorded["mark"][i]["status"] for i in (1, 2)} == {"failed"}
    assert recorded["alerts"] == ["meta-capi-token:" + datetime.now(timezone.utc).strftime("%Y-%m-%d")]


async def test_meta_down_is_retried_until_the_seven_days_run_out(recorded):
    sender = FakeSender(ConversionSendError("caído", status_code=503), ConversionSendError("caído", status_code=503))

    await _send([_row(1, attempts=2)], sender)
    await _send([_row(2, event_time=NOW - timedelta(days=6, hours=23), attempts=4)], sender)

    assert recorded["mark"][1] == {
        "attempts": 3, "next_attempt_at": NOW + timedelta(minutes=30), "last_error": "caído",
    }
    assert recorded["mark"][2]["status"] == "failed"


# --- Cuándo se encola -------------------------------------------------------

@pytest.fixture
def ledger(monkeypatch):
    added: list[dict] = []

    async def add_event(values):
        added.append(values)
        return True

    monkeypatch.setattr(commands.repository, "add_event", add_event)
    monkeypatch.setattr(commands, "wake", lambda: None)
    return added


def _enabled(monkeypatch, value: bool):
    async def enabled():
        return value

    monkeypatch.setattr(commands, "conversions_enabled", enabled)


def _click(monkeypatch, click_id):
    async def last_click_before(_lead_id, _moment):
        return click_id

    monkeypatch.setattr(commands.repository, "last_click_before", last_click_before)


def _currency(monkeypatch, currency):
    async def business_currency():
        return currency

    monkeypatch.setattr(commands, "business_currency", business_currency)


async def test_nothing_is_written_while_the_function_is_off(monkeypatch, ledger):
    _enabled(monkeypatch, False)
    _click(monkeypatch, 5)

    assert await commands.queue_appointment_conversions("L", appointment_id=41, adelanto=80, now=NOW) == []
    assert ledger == []


async def test_without_an_ad_click_there_is_nothing_to_attribute(monkeypatch, ledger):
    _enabled(monkeypatch, True)
    _click(monkeypatch, None)

    assert await commands.queue_appointment_conversions("L", appointment_id=41, adelanto=80, now=NOW) == []
    assert ledger == []


async def test_an_appointment_with_deposit_is_qualified_lead_and_purchase(monkeypatch, ledger):
    _enabled(monkeypatch, True)
    _click(monkeypatch, 5)
    _currency(monkeypatch, "PEN")

    queued = await commands.queue_appointment_conversions("L", appointment_id=41, adelanto=80, now=NOW)

    assert queued == ["QualifiedLead", "Purchase"]
    qualified, purchase = ledger
    assert (qualified["event_key"], qualified["wsp_ad_id"], qualified["status"]) == ("L:QualifiedLead", 5, "pending")
    assert purchase["event_key"] == "L:Purchase:41"
    assert purchase["custom_data"] == {"currency": "PEN", "value": 80.0}


async def test_a_purchase_without_currency_is_skipped_with_its_reason(monkeypatch, ledger):
    _enabled(monkeypatch, True)
    _click(monkeypatch, 5)
    _currency(monkeypatch, None)

    await commands.queue_appointment_conversions("L", appointment_id=41, adelanto=80, now=NOW)

    purchase = ledger[-1]
    assert (purchase["status"], purchase["skip_reason"]) == ("skipped", "sin moneda configurada")


async def test_an_appointment_without_deposit_is_only_qualified_lead(monkeypatch, ledger):
    _enabled(monkeypatch, True)
    _click(monkeypatch, 5)

    assert await commands.queue_appointment_conversions("L", appointment_id=41, adelanto=0, now=NOW) == ["QualifiedLead"]


async def test_a_failure_to_queue_never_breaks_the_appointment(monkeypatch):
    async def broken(*_args, **_kwargs):
        raise RuntimeError("base caída")

    monkeypatch.setattr(subscribers, "queue_appointment_conversions", broken)
    await subscribers.queue_appointment_conversion(LeadAppointmentScheduled(
        lead_id="L", actor=Actor.user(1), appointment_id=41, adelanto=80,
    ))
