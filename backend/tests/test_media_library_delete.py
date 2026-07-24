from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import media_library
from services.media_storage import MediaStorageError


@pytest.mark.asyncio
async def test_delete_library_asset_removes_storage_before_database(monkeypatch):
    events: list[object] = []

    def fake_delete_media(media_url: str) -> None:
        events.append(("storage", media_url))

    async def fake_delete_asset(asset_id: int, *, before_delete):
        await before_delete("/media/example.jpg")
        events.append(("database", asset_id))
        return "/media/example.jpg"

    async def fake_broadcast(payload):
        events.append(("broadcast", payload))

    monkeypatch.setattr(media_library, "delete_media", fake_delete_media)
    monkeypatch.setattr(media_library, "delete_media_asset", fake_delete_asset)
    monkeypatch.setattr(media_library.manager, "broadcast", fake_broadcast)

    result = await media_library.delete_library_asset(42, SimpleNamespace(role="admin"))

    assert result == {"status": "ok"}
    assert events == [
        ("storage", "/media/example.jpg"),
        ("database", 42),
        ("broadcast", {"type": "media_library_updated"}),
    ]


@pytest.mark.asyncio
async def test_delete_library_asset_keeps_record_when_storage_fails(monkeypatch):
    database_deleted = False

    def fake_delete_media(_media_url: str) -> None:
        raise MediaStorageError("MinIO no disponible")

    async def fake_delete_asset(_asset_id: int, *, before_delete):
        nonlocal database_deleted
        await before_delete("/media/example.jpg")
        database_deleted = True
        return "/media/example.jpg"

    monkeypatch.setattr(media_library, "delete_media", fake_delete_media)
    monkeypatch.setattr(media_library, "delete_media_asset", fake_delete_asset)

    with pytest.raises(HTTPException) as exc:
        await media_library.delete_library_asset(42, SimpleNamespace(role="admin"))

    assert exc.value.status_code == 503
    assert database_deleted is False


@pytest.mark.asyncio
async def test_delete_library_asset_reports_when_asset_is_in_use(monkeypatch):
    async def fake_delete_asset(_asset_id: int, *, before_delete):
        del before_delete
        raise ValueError("El archivo está usado en 2 plantilla(s)")

    monkeypatch.setattr(media_library, "delete_media_asset", fake_delete_asset)

    with pytest.raises(HTTPException) as exc:
        await media_library.delete_library_asset(42, SimpleNamespace(role="admin"))

    assert exc.value.status_code == 409
    assert "2 plantilla" in exc.value.detail
