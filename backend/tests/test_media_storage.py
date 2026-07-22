import hashlib
import base64
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import media
from routers.media import _requested_range
from services import media_storage as storage


class FakeS3Error(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class FakeResponse:
    def __init__(self, data: bytes):
        self.data = data
        self.position = 0
        self.closed = False
        self.released = False

    def read(self, size: int) -> bytes:
        chunk = self.data[self.position:self.position + size]
        self.position += len(chunk)
        return chunk

    def close(self):
        self.closed = True

    def release_conn(self):
        self.released = True


class FakeMinio:
    def __init__(self):
        self.objects: dict[tuple[str, str], dict] = {}
        self.last_response: FakeResponse | None = None

    def bucket_exists(self, bucket: str) -> bool:
        return bucket == "crm-media"

    def put_object(self, bucket, object_name, data, length, content_type, metadata):
        raw = data.read(length)
        self.objects[(bucket, object_name)] = {
            "data": raw,
            "content_type": content_type,
            "metadata": {"x-amz-meta-sha256": metadata["sha256"]},
        }

    def stat_object(self, bucket, object_name):
        try:
            item = self.objects[(bucket, object_name)]
        except KeyError as exc:
            raise FakeS3Error("NoSuchKey") from exc
        return SimpleNamespace(
            size=len(item["data"]),
            content_type=item["content_type"],
            metadata=item["metadata"],
        )

    def get_object(self, bucket, object_name, offset=0, length=0):
        try:
            data = self.objects[(bucket, object_name)]["data"]
        except KeyError as exc:
            raise FakeS3Error("NoSuchKey") from exc
        selected = data[offset:offset + length] if length else data[offset:]
        self.last_response = FakeResponse(selected)
        return self.last_response

    def remove_object(self, bucket, object_name):
        self.objects.pop((bucket, object_name), None)


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    path = tmp_path / "media"
    path.mkdir()
    monkeypatch.setattr(storage, "MEDIA_DIR", path)
    return path


def configure_minio(monkeypatch, fake: FakeMinio, *, fallback=False, dual_write=False):
    monkeypatch.setattr(storage.settings, "media_storage_backend", "minio")
    monkeypatch.setattr(storage.settings, "media_local_read_fallback", fallback)
    monkeypatch.setattr(storage.settings, "media_dual_write_local", dual_write)
    monkeypatch.setattr(storage.settings, "minio_endpoint", "minio.internal:9000")
    monkeypatch.setattr(storage.settings, "minio_access_key", "access")
    monkeypatch.setattr(storage.settings, "minio_secret_key", "secret")
    monkeypatch.setattr(storage.settings, "minio_bucket", "crm-media")
    monkeypatch.setattr(storage.settings, "minio_prefix", "dermicapro")
    monkeypatch.setattr(storage, "get_minio_client", lambda: fake)


def test_local_backend_preserves_existing_url_contract(media_dir, monkeypatch):
    monkeypatch.setattr(storage.settings, "media_storage_backend", "local")
    url = storage.save_media_bytes("abc.jpg", b"0123456789", "image/jpeg")

    assert url == "/media/abc.jpg"
    assert storage.stat_media(url).source == "local"
    assert storage.read_media_bytes(url) == b"0123456789"
    assert b"".join(storage.iter_media(url, 3, 4)) == b"3456"

    storage.delete_media(url)
    assert not (media_dir / "abc.jpg").exists()


def test_minio_backend_uploads_reads_ranges_and_deletes(media_dir, monkeypatch):
    fake = FakeMinio()
    configure_minio(monkeypatch, fake)

    url = storage.save_media_bytes("voice.ogg", b"abcdefghij", "audio/ogg")
    item = fake.objects[("crm-media", "dermicapro/audio/voice.ogg")]
    assert item["data"] == b"abcdefghij"
    assert item["metadata"]["x-amz-meta-sha256"] == hashlib.sha256(b"abcdefghij").hexdigest()
    assert not (media_dir / "voice.ogg").exists()
    assert b"".join(storage.iter_media(url, 2, 5)) == b"cdefg"
    assert fake.last_response and fake.last_response.closed and fake.last_response.released

    storage.delete_media(url)
    assert ("crm-media", "dermicapro/audio/voice.ogg") not in fake.objects


def test_minio_resolves_extensionless_audio_in_audio_prefix(media_dir, monkeypatch):
    fake = FakeMinio()
    configure_minio(monkeypatch, fake)
    object_name = "dermicapro/audio/extensionless"
    fake.objects[("crm-media", object_name)] = {
        "data": b"opus-audio",
        "content_type": "audio/webm",
        "metadata": {},
    }

    url = "/media/extensionless"
    info = storage.stat_media(url)
    assert info.source == "minio"
    assert info.object_name == object_name
    assert storage.read_media_bytes(url) == b"opus-audio"

    storage.delete_media(url)
    assert ("crm-media", object_name) not in fake.objects


def test_audio_webm_gets_stable_extension(monkeypatch):
    saved = {}

    def fake_save(filename, data, content_type):
        saved.update(filename=filename, data=data, content_type=content_type)
        return f"/media/{filename}"

    monkeypatch.setattr(media, "save_media_bytes", fake_save)
    result = media.save_media_file(
        "audio/webm;codecs=opus",
        base64.b64encode(b"webm-audio").decode("ascii"),
    )

    assert result.endswith(".weba")
    assert saved["filename"].endswith(".weba")
    assert saved["content_type"] == "audio/webm"


def test_minio_transition_can_dual_write_and_fallback_to_local(media_dir, monkeypatch):
    fake = FakeMinio()
    configure_minio(monkeypatch, fake, fallback=True, dual_write=True)

    url = storage.save_media_bytes("new.mp4", b"video", "video/mp4")
    assert (media_dir / "new.mp4").read_bytes() == b"video"

    (media_dir / "legacy.jpg").write_bytes(b"legacy")
    info = storage.stat_media("/media/legacy.jpg")
    assert info.source == "local"
    assert storage.read_media_bytes("/media/legacy.jpg") == b"legacy"

    storage.delete_media(url)
    assert not (media_dir / "new.mp4").exists()


def test_rejects_paths_outside_media_namespace(media_dir, monkeypatch):
    monkeypatch.setattr(storage.settings, "media_storage_backend", "local")
    with pytest.raises(storage.MediaStorageError):
        storage.stat_media("/media/../secret.txt")
    with pytest.raises(storage.MediaStorageError):
        storage.stat_media("/other/file.jpg")


def test_http_byte_ranges():
    assert _requested_range(None, 100) == (0, 100, 200)
    assert _requested_range("bytes=10-19", 100) == (10, 10, 206)
    assert _requested_range("bytes=90-", 100) == (90, 10, 206)
    assert _requested_range("bytes=-10", 100) == (90, 10, 206)
    with pytest.raises(HTTPException) as exc:
        _requested_range("bytes=100-101", 100)
    assert exc.value.status_code == 416


@pytest.mark.parametrize(
    ("filename", "content_type", "expected"),
    [
        ("photo.jpg", "image/jpeg", "dermicapro/images/photo.jpg"),
        ("voice.ogg", "audio/ogg", "dermicapro/audio/voice.ogg"),
        ("clip.mp4", "video/mp4", "dermicapro/video/clip.mp4"),
        ("contract.pdf", "application/pdf", "dermicapro/files/contract.pdf"),
    ],
)
def test_minio_object_paths_are_grouped_by_media_kind(
    filename, content_type, expected, monkeypatch
):
    monkeypatch.setattr(storage.settings, "minio_prefix", "dermicapro")
    assert storage._object_name_from_filename(filename, content_type) == expected
