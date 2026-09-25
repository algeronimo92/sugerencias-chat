"""Vectores RFC y propiedades esenciales del segundo factor."""

import base64
from datetime import datetime, timezone
from types import SimpleNamespace

from services import admin_totp
from services.admin_totp import _matching_step, _new_recovery_code, _recovery_hash, _totp


def test_totp_matches_rfc_6238_sha1_vector_truncated_to_six_digits():
    secret = base64.b32encode(b"12345678901234567890").decode("ascii")
    assert _totp(secret, 59 // 30) == "287082"
    assert _matching_step(secret, "287082", now=59) == 1
    assert _matching_step(secret, "287082", now=90) is None


def test_recovery_codes_are_long_and_normalized_for_verification():
    first = _new_recovery_code()
    second = _new_recovery_code()
    assert first != second
    assert len(first.replace("-", "")) == 20
    assert _recovery_hash(first) == _recovery_hash(first.lower().replace("-", ""))


class _FakeSession:
    def __init__(self, row, recovery=None):
        self.row = row
        self.recovery = recovery

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def begin(self):
        return self

    async def scalar(self, _query):
        return self.row

    async def get(self, _model, _key):
        return self.recovery

    async def delete(self, row):
        if row is self.recovery:
            self.recovery = None


async def test_totp_step_cannot_be_reused(monkeypatch):
    secret = base64.b32encode(b"12345678901234567890").decode("ascii")
    row = SimpleNamespace(enabled_at=datetime.now(timezone.utc), secret_ciphertext="encrypted", last_used_step=None)
    session = _FakeSession(row)
    monkeypatch.setattr(admin_totp, "get_sessionmaker", lambda: lambda: session)
    monkeypatch.setattr(admin_totp, "_decrypt", lambda _user_id, _value: secret)
    monkeypatch.setattr(admin_totp.time, "time", lambda: 59)

    assert await admin_totp.verify_mfa(7, "287082") is True
    assert await admin_totp.verify_mfa(7, "287082") is False


async def test_recovery_code_is_single_use(monkeypatch):
    secret = base64.b32encode(b"12345678901234567890").decode("ascii")
    row = SimpleNamespace(enabled_at=datetime.now(timezone.utc), secret_ciphertext="encrypted", last_used_step=None)
    recovery = SimpleNamespace(code_hash=_recovery_hash("AAAAA-BBBBB-CCCCC-DDDDD"))
    session = _FakeSession(row, recovery)
    monkeypatch.setattr(admin_totp, "get_sessionmaker", lambda: lambda: session)
    monkeypatch.setattr(admin_totp, "_decrypt", lambda _user_id, _value: secret)

    assert await admin_totp.verify_mfa(7, "AAAAA-BBBBB-CCCCC-DDDDD") is True
    assert await admin_totp.verify_mfa(7, "AAAAA-BBBBB-CCCCC-DDDDD") is False
