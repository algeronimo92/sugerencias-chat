"""Endpoint del webhook de Meta: suscripción, firma HMAC y guardado crudo."""

import hashlib
import hmac
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.integrations.meta_webhook import api as meta_webhook
from app.integrations.meta_webhook import auth as meta_webhook_auth
from tests.meta_fixtures import inbound_webhook

SECRET = "app-secret"
VERIFY_TOKEN = "verify-token"


@pytest.fixture
def client(monkeypatch):
    settings = {"meta_app_secret": SECRET, "meta_verify_token": VERIFY_TOKEN}

    async def platform_setting(key):
        return settings[key]

    monkeypatch.setattr(meta_webhook_auth, "platform_setting", platform_setting)
    stored = AsyncMock(return_value=(["evt-1"], 0))
    monkeypatch.setattr(meta_webhook, "store_changes", stored)
    notified = []
    async def notify():
        notified.append(True)

    monkeypatch.setattr(meta_webhook, "notify_new_events", notify)
    app = FastAPI()
    app.include_router(meta_webhook.router)
    test_client = TestClient(app)
    test_client.stored = stored
    test_client.notified = notified
    return test_client


def _signature(raw: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def test_subscription_answers_the_challenge_only_with_the_right_token(client):
    ok = client.get("/api/webhooks/meta/whatsapp", params={
        "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "12345",
    })
    assert (ok.status_code, ok.text) == (200, "12345")

    wrong = client.get("/api/webhooks/meta/whatsapp", params={
        "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "12345",
    })
    assert wrong.status_code == 403


def test_signed_body_is_stored_raw_per_change_and_wakes_the_worker(client):
    body = inbound_webhook("button")
    # Bytes exactos: la firma se calcula sobre ellos, no sobre el JSON reparseado.
    raw = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()

    response = client.post(
        "/api/webhooks/meta/whatsapp",
        content=raw,
        headers={"X-Hub-Signature-256": _signature(raw), "Content-Type": "application/json"},
    )

    assert response.status_code == 200
    assert response.json() == {"received": 1, "duplicates": 0}
    [changes] = client.stored.await_args.args
    changes = list(changes)
    assert len(changes) == 1
    assert changes[0]["field"] == "messages"
    assert changes[0]["value"] == body["entry"][0]["changes"][0]["value"]
    assert client.notified == [True]


@pytest.mark.parametrize("signature", [None, "sha256=deadbeef", "md5=abc"])
def test_unsigned_or_badly_signed_bodies_are_rejected_before_storing(client, signature):
    raw = json.dumps(inbound_webhook("text")).encode()
    headers = {"Content-Type": "application/json"}
    if signature:
        headers["X-Hub-Signature-256"] = signature

    response = client.post("/api/webhooks/meta/whatsapp", content=raw, headers=headers)

    assert response.status_code == 401
    client.stored.assert_not_awaited()


def test_a_body_signed_with_another_secret_is_rejected(client):
    raw = json.dumps(inbound_webhook("text")).encode()
    response = client.post(
        "/api/webhooks/meta/whatsapp", content=raw,
        headers={"X-Hub-Signature-256": _signature(raw, "otro-secreto")},
    )
    assert response.status_code == 401


def test_replayed_delivery_is_acknowledged_without_waking_the_worker(client):
    client.stored.return_value = ([], 1)
    raw = json.dumps(inbound_webhook("text")).encode()

    response = client.post(
        "/api/webhooks/meta/whatsapp", content=raw, headers={"X-Hub-Signature-256": _signature(raw)},
    )

    assert response.json() == {"received": 0, "duplicates": 1}
    assert client.notified == []
