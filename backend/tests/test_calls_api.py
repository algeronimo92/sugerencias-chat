"""Quién puede hacer qué con una llamada de WhatsApp
(docs/analisis/17-plan-llamadas-whatsapp.md, tabla de rutas de §4.2)."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.bootstrap import domain_error_handler
from app.core.errors import DomainError
from app.modules.auth.public import get_current_user
from app.modules.auth.role_policy import route_allowed_for
from app.modules.conversations import calls_api
from app.modules.leads import visibility

SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n"
ROW = {
    "id": 7, "chat_id": "lead-1", "direction": "inbound", "status": "accepted", "cause": None, "error_code": None,
    "ringing_at": datetime(2026, 11, 19, tzinfo=timezone.utc), "accepted_at": None, "ended_at": None,
    "duration_seconds": None, "handled_by_user_id": 2,
}


def _user(**overrides):
    return SimpleNamespace(**{"id": 2, "role": "vendedor", "can_handle_calls": True, **overrides})


@pytest.fixture
def api(monkeypatch):
    for name in ("answer_call", "confirm_call_connected", "dismiss_call", "hang_up"):
        monkeypatch.setattr(calls_api, name, AsyncMock(return_value=ROW))
    monkeypatch.setattr(calls_api, "ringing_calls", AsyncMock(return_value=[]))
    monkeypatch.setattr(calls_api, "chat_calls", AsyncMock(return_value=[]))
    monkeypatch.setattr(calls_api, "call_offer", AsyncMock(return_value={"call_id": 7, "sdp": SDP}))
    # Todo el equipo ve todos los leads (el ajuste por defecto).
    monkeypatch.setattr(visibility, "sellers_see_only_assigned_leads", AsyncMock(return_value=False))
    app = FastAPI()
    app.add_exception_handler(DomainError, domain_error_handler)
    app.include_router(calls_api.router)

    def as_user(user) -> TestClient:
        app.dependency_overrides[get_current_user] = lambda: user
        return TestClient(app)

    return as_user


AGENT_ROUTES = [
    ("get", "/api/calls/ringing", None),
    ("get", "/api/calls/7/offer", None),
    ("post", "/api/calls/7/accept", {"sdp": SDP, "client_id": "tab"}),
    ("post", "/api/calls/7/connected", None),
    ("post", "/api/calls/7/dismiss", None),
    ("post", "/api/calls/7/terminate", {}),
]


@pytest.mark.parametrize(("method", "path", "body"), AGENT_ROUTES)
def test_someone_with_the_calls_permission_can_use_every_call_route(api, method, path, body):
    response = api(_user()).request(method, path, json=body)
    assert response.status_code == 200


@pytest.mark.parametrize(("method", "path", "body"), AGENT_ROUTES)
@pytest.mark.parametrize("user", [
    _user(can_handle_calls=False),
    # Un analista con el permiso heredado de antes tampoco: no abre chats.
    _user(role="analista"),
])
def test_without_the_permission_nothing_rings_nor_can_be_answered(api, user, method, path, body):
    response = api(user).request(method, path, json=body)
    assert response.status_code == 403
    calls_api.answer_call.assert_not_awaited()


def test_anyone_who_sees_chats_sees_the_calls_of_a_chat(api):
    assert api(_user(can_handle_calls=False)).get("/api/calls", params={"chat_id": "lead-1"}).status_code == 200


@pytest.mark.parametrize(("method", "path"), [("GET", "/api/calls"), ("GET", "/api/calls/ringing"), ("POST", "/api/calls/7/accept")])
def test_the_analyst_cannot_reach_any_call_route(method, path):
    assert route_allowed_for("analista", method, path) is False


def test_answering_passes_the_tab_and_the_audio_description(api):
    api(_user()).post("/api/calls/7/accept", json={"sdp": SDP, "client_id": "tab-9", "pre_accept": True})
    calls_api.answer_call.assert_awaited_once_with(7, user_id=2, client_id="tab-9", sdp=SDP, pre_accept=True)


def test_hanging_up_tells_whether_it_is_an_admin_and_what_the_browser_saw(api):
    api(_user(role="admin", id=1)).post("/api/calls/7/terminate", json={"cause": "no_audio"})
    calls_api.hang_up.assert_awaited_once_with(7, user_id=1, is_admin=True, cause="no_audio")


def test_the_screen_never_receives_the_offer_in_a_call(api):
    body = api(_user()).post("/api/calls/7/connected").json()
    assert "remote_sdp" not in body and "events" not in body


@pytest.mark.parametrize(("method", "path", "body"), AGENT_ROUTES + [
    ("get", "/api/calls/7/answer", None),
])
def test_restricted_seller_cannot_access_a_foreign_call(api, monkeypatch, method, path, body):
    monkeypatch.setattr(visibility, "sellers_see_only_assigned_leads", AsyncMock(return_value=True))
    monkeypatch.setattr(visibility, "fetch_lead_sellers", AsyncMock(return_value={"lead-1": 99}))
    monkeypatch.setattr(calls_api, "call_chat_id", AsyncMock(return_value="lead-1"))
    if path.endswith("ringing"):
        monkeypatch.setattr(calls_api, "ringing_calls", AsyncMock(return_value=[{**ROW, "chat_id": "lead-1"}]))
    response = api(_user()).request(method, path, json=body)
    if path.endswith("ringing"):
        assert response.status_code == 200
        assert response.json() == []
    else:
        assert response.status_code == 404
    calls_api.answer_call.assert_not_awaited()


def test_restricted_seller_cannot_start_a_call_to_a_foreign_lead(api, monkeypatch):
    monkeypatch.setattr(visibility, "sellers_see_only_assigned_leads", AsyncMock(return_value=True))
    monkeypatch.setattr(visibility, "fetch_lead_sellers", AsyncMock(return_value={"lead-1": 99}))
    start = AsyncMock(return_value=ROW)
    monkeypatch.setattr(calls_api, "start_call", start)
    response = api(_user()).post("/api/calls", json={"chat_id": "lead-1", "sdp": SDP, "client_id": "tab"})
    assert response.status_code == 404
    start.assert_not_awaited()


@pytest.mark.parametrize("user", [_user(), _user(role="admin")])
def test_own_calls_and_admins_still_work_with_the_setting_on(api, monkeypatch, user):
    monkeypatch.setattr(visibility, "sellers_see_only_assigned_leads", AsyncMock(return_value=True))
    monkeypatch.setattr(visibility, "fetch_lead_sellers", AsyncMock(return_value={"lead-1": 2}))
    monkeypatch.setattr(calls_api, "call_chat_id", AsyncMock(return_value="lead-1"))
    response = api(user).post("/api/calls/7/accept", json={"sdp": SDP, "client_id": "tab"})
    assert response.status_code == 200
