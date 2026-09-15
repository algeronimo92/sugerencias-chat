from datetime import datetime, timezone

from routers import chats
from services import automation_rules


class _LateNightInLima(datetime):
    @classmethod
    def now(cls, tz=None):
        instant = datetime(2026, 9, 16, 4, 0, tzinfo=timezone.utc)
        return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)


def test_manual_interactive_uses_business_date_not_server_utc_date(monkeypatch):
    monkeypatch.setattr(automation_rules, "datetime", _LateNightInLima)

    rendered = chats._render_interactive_config(
        {"title": "Hoy {{fecha_actual}}", "buttons": [{"displayText": "{{nombre}}"}]},
        {"name": "Ana"},
    )

    assert rendered == {"title": "Hoy 15/09/2026", "buttons": [{"displayText": "Ana"}]}
