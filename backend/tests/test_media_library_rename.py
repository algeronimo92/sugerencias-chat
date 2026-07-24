from types import SimpleNamespace

import pytest

from models.schemas import MediaAssetUpdate
from routers import media_library
from services import media_library_service


@pytest.mark.parametrize(
    "filename,current,expected",
    [
        ("  campaña julio.JPG  ", "original.jpg", "campaña julio.JPG"),
        ("propuesta final.pdf", "documento.pdf", "propuesta final.pdf"),
    ],
)
def test_validated_media_filename_preserves_extension(filename, current, expected):
    assert media_library_service.validated_media_filename(filename, current) == expected


@pytest.mark.parametrize("filename", ["", "../foto.jpg", "carpeta/foto.jpg", "foto.png", "foto\n.jpg"])
def test_validated_media_filename_rejects_unsafe_names(filename):
    with pytest.raises(ValueError):
        media_library_service.validated_media_filename(filename, "foto.jpg")


@pytest.mark.asyncio
async def test_rename_updates_library_and_linked_template_attachments(monkeypatch):
    statements = []
    committed = False

    class FakeResult:
        def scalar_one_or_none(self):
            return SimpleNamespace(filename="original.jpg")

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)
            return FakeResult()

        async def commit(self):
            nonlocal committed
            committed = True

    async def fake_get_asset(asset_id):
        return {"id": asset_id, "filename": "nuevo.jpg"}

    monkeypatch.setattr(media_library_service, "get_sessionmaker", lambda: FakeSession)
    monkeypatch.setattr(media_library_service, "get_media_asset", fake_get_asset)

    result = await media_library_service.rename_media_asset(42, "nuevo.jpg")

    assert result == {"id": 42, "filename": "nuevo.jpg"}
    assert committed
    sql = "\n".join(str(statement) for statement in statements)
    assert "UPDATE media_assets" in sql
    assert "UPDATE template_attachments" in sql


@pytest.mark.asyncio
async def test_patch_rename_broadcasts_library_and_template_updates(monkeypatch):
    events = []

    async def fake_rename(asset_id, filename):
        events.append(("rename", asset_id, filename))
        return {"id": asset_id, "filename": filename}

    async def fake_broadcast(payload):
        events.append(("broadcast", payload))

    monkeypatch.setattr(media_library, "rename_media_asset", fake_rename)
    monkeypatch.setattr(media_library.manager, "broadcast", fake_broadcast)

    result = await media_library.patch_library_asset(
        42,
        MediaAssetUpdate(filename="nuevo.jpg"),
        _admin=SimpleNamespace(role="admin"),
    )

    assert result == {"id": 42, "filename": "nuevo.jpg"}
    assert events == [
        ("rename", 42, "nuevo.jpg"),
        ("broadcast", {"type": "media_library_updated"}),
        ("broadcast", {"type": "templates_updated"}),
    ]
