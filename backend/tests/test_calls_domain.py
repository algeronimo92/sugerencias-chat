"""Reglas de las llamadas de WhatsApp que no necesitan base
(docs/analisis/17-plan-llamadas-whatsapp.md, §4.2 y §4.9)."""

import pytest

from app.integrations.meta.calls import parse_call, without_sdp
from app.modules.conversations.domain import calls as rules

SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n"


@pytest.mark.parametrize(("code", "cause"), [
    ("138000", "account_disabled"), ("138001", "customer_uncallable"), ("138002", "account_limit"),
    ("138004", "no_audio"), ("138005", "account_limit"), ("138006", "no_permission"),
    ("138007", "unconfirmed"), ("138009", "account_limit"), ("138012", "account_limit"),
    ("138013", "account_disabled"), ("138014", "account_paused"), ("138015", "account_disabled"),
    ("138018", "account_disabled"), ("138019", "no_audio"), ("138020", "no_audio"),
    ("138021", "no_audio"), ("138022", "no_audio"), ("138023", "no_audio"), ("138037", "account_limit"),
    (138021, "no_audio"),
    # Un código que Meta agregue mañana no se pierde: cae en "otro".
    ("139999", "other"),
    (None, None), ("", None),
])
def test_every_meta_code_has_a_cause(code, cause):
    assert rules.cause_for_meta_code(code) == cause


def test_every_cause_says_who_can_fix_it():
    assert {cause.group for cause in rules.CAUSES.values()} == {"team", "device", "customer", "account", "system"}
    assert all(cause.label for cause in rules.CAUSES.values())
    assert rules.BROWSER_CAUSES <= set(rules.CAUSES)


@pytest.mark.parametrize(("ringing_for", "agents", "dismissed", "cause"), [
    (2.0, True, False, "quick_hangup"),
    (30.0, True, True, "all_dismissed"),
    (30.0, False, False, "nobody_connected"),
    (30.0, True, False, "no_answer"),
    (None, True, False, "no_answer"),
])
def test_why_a_call_was_missed(ringing_for, agents, dismissed, cause):
    assert rules.missed_cause(ringing_for, agents_connected=agents, all_dismissed=dismissed) == cause


@pytest.mark.parametrize("sdp", ["", "hola", "x" * 30_000, "v=0" + "a" * 30_000])
def test_a_bad_sdp_is_not_forwarded(sdp):
    with pytest.raises(rules.InvalidSdp):
        rules.validate_sdp(sdp)


def test_a_normal_sdp_passes():
    assert rules.validate_sdp(SDP) == SDP


def test_a_connect_event_is_read_with_its_offer():
    call = parse_call({
        "id": "wacid.A", "event": "connect", "direction": "USER_INITIATED", "timestamp": "1700000000",
        "from": "51999888777", "session": {"sdp_type": "offer", "sdp": SDP},
    })
    assert (call.wa_call_id, call.event, call.user_initiated, call.sdp) == ("wacid.A", "connect", True, SDP)
    assert call.occurred_at is not None


def test_a_terminate_event_carries_duration_and_error():
    done = parse_call({"id": "wacid.A", "event": "terminate", "duration": 120, "start_time": "1700000000", "end_time": "1700000120"})
    assert (done.duration_seconds, done.error_code) == (120, None)
    failed = parse_call({"id": "wacid.B", "event": "terminate"}, [{"code": 138021}])
    assert failed.error_code == "138021"
    assert failed.duration_seconds is None


def test_the_meta_test_sample_without_direction_counts_as_from_the_customer():
    assert parse_call({"id": "ABGG", "event": "connect"}).user_initiated is True
    assert parse_call({"id": "ABGG", "event": "connect", "direction": "BUSINESS_INITIATED"}).user_initiated is False


@pytest.mark.parametrize("call", [{}, {"id": "x"}, {"event": "connect"}, {"id": "", "event": "connect"}])
def test_an_event_without_id_or_type_is_skipped(call):
    assert parse_call(call) is None


def test_the_offer_is_removed_from_the_stored_webhook():
    change = {"field": "calls", "value": {"calls": [{"id": "wacid.A", "session": {"sdp_type": "offer", "sdp": SDP}}]}}
    cleaned = without_sdp(change)
    assert cleaned["value"]["calls"][0]["session"] == {"sdp_type": "offer"}
    # No toca el original: el hash de deduplicación se calculó sobre él.
    assert change["value"]["calls"][0]["session"]["sdp"] == SDP
