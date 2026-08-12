from types import SimpleNamespace

import pytest

from routers import tags


@pytest.mark.asyncio
async def test_admin_catalog_includes_inactive_tags(monkeypatch):
    expected = [
        {"id": 1, "name": "VIP", "color": "#16a34a", "is_active": True},
        {"id": 2, "name": "Antigua", "color": "#64748b", "is_active": False},
    ]
    received = None

    async def fake_list_tags(include_inactive=False):
        nonlocal received
        received = include_inactive
        return expected

    monkeypatch.setattr(tags, "list_tags", fake_list_tags)

    result = await tags.get_all_tags(SimpleNamespace(id=1, role="admin"))

    assert received is True
    assert result == expected
