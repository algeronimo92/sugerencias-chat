import hashlib
import hmac
from unittest.mock import AsyncMock

import pytest

from services import meta_webhook_auth


@pytest.mark.asyncio
async def test_verify_challenge_accepts_subscribe_with_matching_token(monkeypatch):
    monkeypatch.setattr(meta_webhook_auth, "platform_setting", AsyncMock(return_value="expected-token"))

    assert await meta_webhook_auth.verify_challenge("subscribe", "expected-token") is True


@pytest.mark.asyncio
async def test_verify_challenge_rejects_wrong_token_or_mode(monkeypatch):
    monkeypatch.setattr(meta_webhook_auth, "platform_setting", AsyncMock(return_value="expected-token"))

    assert await meta_webhook_auth.verify_challenge("subscribe", "wrong-token") is False
    assert await meta_webhook_auth.verify_challenge("unsubscribe", "expected-token") is False
    assert await meta_webhook_auth.verify_challenge("subscribe", None) is False


@pytest.mark.asyncio
async def test_verify_challenge_fails_closed_without_configured_token(monkeypatch):
    monkeypatch.setattr(meta_webhook_auth, "platform_setting", AsyncMock(return_value=""))

    with pytest.raises(RuntimeError):
        await meta_webhook_auth.verify_challenge("subscribe", "anything")


@pytest.mark.asyncio
async def test_verify_signature_accepts_matching_hmac(monkeypatch):
    secret = "synthetic-app-secret"
    raw_body = b'{"entry":[{"id":"synthetic"}]}'
    signature = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    monkeypatch.setattr(meta_webhook_auth, "platform_setting", AsyncMock(return_value=secret))

    assert await meta_webhook_auth.verify_signature(raw_body, signature) is True


@pytest.mark.asyncio
async def test_verify_signature_rejects_mismatched_or_missing_signature(monkeypatch):
    monkeypatch.setattr(meta_webhook_auth, "platform_setting", AsyncMock(return_value="synthetic-app-secret"))

    assert await meta_webhook_auth.verify_signature(b"payload", "sha256=" + "0" * 64) is False
    assert await meta_webhook_auth.verify_signature(b"payload", "") is False
    assert await meta_webhook_auth.verify_signature(b"payload", "not-sha256=abc") is False


@pytest.mark.asyncio
async def test_verify_signature_fails_closed_without_configured_secret(monkeypatch):
    monkeypatch.setattr(meta_webhook_auth, "platform_setting", AsyncMock(return_value=""))

    with pytest.raises(RuntimeError):
        await meta_webhook_auth.verify_signature(b"payload", "sha256=" + "0" * 64)
