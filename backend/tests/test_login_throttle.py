from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from services.login_throttle import ACCOUNT_LIMIT, LOCK, WINDOW, _consume, _key


def test_account_and_ip_have_separate_keys():
    assert _key("crm:account", "ana@example.com") != _key("crm:ip", "ana@example.com")
    assert _key("crm:account", "ana@example.com") != _key("platform:account", "ana@example.com")


def test_account_locks_after_five_attempts_and_resets_after_window():
    now = datetime.now(timezone.utc)
    row = SimpleNamespace(attempts=0, window_started_at=now, locked_until=None)
    for _ in range(ACCOUNT_LIMIT):
        assert _consume(row, ACCOUNT_LIMIT, now) is False
    assert _consume(row, ACCOUNT_LIMIT, now) is True
    assert row.locked_until == now + LOCK
    assert _consume(row, ACCOUNT_LIMIT, now + WINDOW + LOCK) is False
    assert row.attempts == 1
