import hashlib
import base64
import shutil
import subprocess
import tempfile
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.media import api as media
from app.modules.media import media_upload
from app.modules.media.api import _requested_range
from app.integrations.storage import media_storage as storage


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


def configure_minio(monkeypatch, fake: FakeMinio):
    monkeypatch.setattr(storage.settings, "media_storage_backend", "minio")
    monkeypatch.setattr(storage.settings, "minio_endpoint", "minio.internal:9000")
    monkeypatch.setattr(storage.settings, "minio_access_key", "access")
    monkeypatch.setattr(storage.settings, "minio_secret_key", "secret")
    monkeypatch.setattr(storage.settings, "minio_bucket", "crm-media")
    monkeypatch.setattr(storage.settings, "minio_prefix", "dermicapro")
    monkeypatch.setattr(storage, "get_minio_client", lambda: fake)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="requiere ffmpeg instalado")
def test_transcode_audio_to_ogg_opus_converts_webm_recording():
    """Lo que graba el navegador (webm/opus) tiene que salir como un .ogg de
    verdad: Meta Cloud API acepta el webm igual pero nunca lo reproduce como
    nota de voz, y el mensaje se queda sin doble check para siempre."""
    import os

    # No usar NamedTemporaryFile con el handle abierto: en Windows ffmpeg no
    # puede escribir sobre un archivo que Python todavía tiene abierto.
    src_path = tempfile.mktemp(suffix=".webm")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
             "-c:a", "libopus", src_path],
            capture_output=True, check=True,
        )
        with open(src_path, "rb") as handle:
            data = handle.read()
    finally:
        if os.path.exists(src_path):
            os.remove(src_path)

    result = storage.transcode_audio_to_ogg_opus(data)

    assert result[:4] == b"OggS"


def test_transcode_audio_to_ogg_opus_raises_when_ffmpeg_missing(monkeypatch):
    # transcode_audio_to_ogg_opus hace `import shutil` local (mismo patrón que
    # compress_video), así que parchear el módulo global shutil.which alcanza.
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    with pytest.raises(storage.AudioTranscodeError):
        storage.transcode_audio_to_ogg_opus(b"not-really-audio")


def _ffmpeg_video(*codec_args: str) -> bytes:
    """Un segundo de video de prueba (con audio) codificado como se pida."""
    import os

    # Ver test_transcode_audio_to_ogg_opus_converts_webm_recording: en Windows
    # ffmpeg no escribe sobre un archivo que Python tenga abierto.
    path = tempfile.mktemp(suffix=".mp4")
    try:
        subprocess.run(
            ["ffmpeg", "-y",
             "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
             *codec_args, "-shortest", path],
            capture_output=True, check=True,
        )
        with open(path, "rb") as handle:
            return handle.read()
    finally:
        if os.path.exists(path):
            os.remove(path)


requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="requiere ffmpeg y ffprobe instalados",
)


@requires_ffmpeg
def test_vp9_inside_mp4_is_converted_to_h264():
    """Regresión: un .mp4 con video VP9 salía tal cual por pesar poco, y Meta
    lo descartaba después del envío con 131053 "No video stream found"."""
    vp9 = _ffmpeg_video("-c:v", "libvpx-vp9", "-c:a", "aac")
    assert storage.video_is_whatsapp_compatible(vp9) is False

    converted = storage.compress_video(vp9)

    assert storage.video_is_whatsapp_compatible(converted) is True


@requires_ffmpeg
def test_h264_aac_mp4_is_whatsapp_compatible():
    h264 = _ffmpeg_video("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac")
    assert storage.video_is_whatsapp_compatible(h264) is True


def test_video_compatibility_is_unknown_without_ffprobe(monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    assert storage.video_is_whatsapp_compatible(b"not-really-video") is None


@pytest.mark.parametrize(
    ("content_type", "compatible", "converts"),
    [
        ("video/mp4", False, True),       # VP9/HEVC disfrazado de .mp4
        ("video/mp4", True, False),       # ya sirve: no se toca
        ("video/mp4", None, False),       # no se pudo leer: no se convierte a ciegas
        ("video/quicktime", True, True),  # .mov: Meta no acepta el contenedor
        ("video/webm", None, True),
    ],
)
def test_upload_converts_videos_whatsapp_cannot_play(content_type, compatible, converts, monkeypatch):
    saved = {}

    def fake_save(filename, data, content_type):
        saved.update(filename=filename, data=data, content_type=content_type)
        return f"/media/{filename}"

    monkeypatch.setattr(media_upload, "save_media_bytes", fake_save)
    monkeypatch.setattr(media_upload, "video_is_whatsapp_compatible", lambda _raw: compatible)
    monkeypatch.setattr(media_upload, "compress_video", lambda _raw, _max: b"h264-video")

    url = media_upload.save_decoded_media(content_type, b"original-video", "clip.mov")

    if converts:
        assert saved["data"] == b"h264-video"
        assert saved["content_type"] == "video/mp4"
        assert url.endswith(".mp4")
    else:
        assert saved["data"] == b"original-video"
        assert saved["content_type"] == content_type


def test_upload_compresses_compatible_video_over_whatsapp_limit(monkeypatch):
    """Un H.264 correcto de 20 MB antes se guardaba tal cual (el tope era
    25 MB) y el envío fallaba recién en el worker: Meta rechaza videos de más
    de 16 MB al subirlos."""
    saved = {}
    calls = []

    def fake_save(filename, data, content_type):
        saved.update(data=data, content_type=content_type)
        return f"/media/{filename}"

    def fake_compress(raw, max_bytes):
        calls.append(max_bytes)
        return b"h264-16mb"

    monkeypatch.setattr(media_upload, "save_media_bytes", fake_save)
    monkeypatch.setattr(media_upload, "video_is_whatsapp_compatible", lambda _raw: True)
    monkeypatch.setattr(media_upload, "compress_video", fake_compress)

    media_upload.save_decoded_media("video/mp4", b"x" * (20 * 1024 * 1024), "clip.mp4")

    assert calls == [storage.WHATSAPP_VIDEO_MAX_BYTES]
    assert saved == {"data": b"h264-16mb", "content_type": "video/mp4"}


def test_upload_rejects_video_still_over_limit_after_conversion(monkeypatch):
    monkeypatch.setattr(media_upload, "save_media_bytes", lambda *a: "/media/x.mp4")
    monkeypatch.setattr(media_upload, "video_is_whatsapp_compatible", lambda _raw: True)
    monkeypatch.setattr(media_upload, "compress_video", lambda raw, _max: raw)

    with pytest.raises(ValueError, match="grande"):
        media_upload.save_decoded_media("video/mp4", b"x" * (17 * 1024 * 1024), "clip.mp4")


def test_upload_rejects_video_source_too_big_to_convert(monkeypatch):
    """Los endpoints responden 413 cuando el motivo dice "grande"."""
    monkeypatch.setattr(media_upload, "save_media_bytes", lambda *a: "/media/x.mp4")
    monkeypatch.setattr(media_upload, "compress_video", lambda *a: pytest.fail("no debería convertir"))

    with pytest.raises(ValueError, match="grande"):
        media_upload.save_decoded_media("video/mp4", b"x" * (101 * 1024 * 1024), "clip.mp4")


def test_other_media_keeps_the_general_limit(monkeypatch):
    monkeypatch.setattr(media_upload, "save_media_bytes", lambda *a: "/media/x.pdf")
    media_upload.save_decoded_media("application/pdf", b"x" * (20 * 1024 * 1024), "doc.pdf")
    with pytest.raises(ValueError, match="grande"):
        media_upload.save_decoded_media("application/pdf", b"x" * (26 * 1024 * 1024), "doc.pdf")


def test_encode_plan_keeps_1080p_when_the_budget_allows():
    # 30 s como el ejemplo: entra 1080p a casi 4 Mbps sin tocar el techo.
    plan = storage.plan_video_encode(30.0, 1920, 29.97)
    assert plan.max_side == 1920
    assert plan.fps is None
    assert plan.audio_bitrate == storage.AUDIO_BITRATE
    assert 3_800_000 <= plan.video_bitrate <= 4_200_000


def test_encode_plan_caps_bitrate_and_fps_for_short_clips():
    plan = storage.plan_video_encode(5.0, 1920, 60.0)
    assert plan.video_bitrate == storage.VIDEO_MAX_BITRATE
    assert plan.fps == storage.VIDEO_MAX_FPS


def test_encode_plan_steps_down_resolution_before_quality():
    # 16 MB dan ~1,4 Mbps para 80 s y ~0,5 Mbps para 3 min: 720p y 480p.
    eighty_seconds = storage.plan_video_encode(80.0, 1920, 30.0)
    assert eighty_seconds.max_side == 1280
    three_minutes = storage.plan_video_encode(180.0, 1920, 30.0)
    assert three_minutes.max_side == 854
    assert three_minutes.audio_bitrate == storage.AUDIO_BITRATE
    five_minutes = storage.plan_video_encode(300.0, 1920, 30.0)
    assert five_minutes.max_side == 854
    assert five_minutes.audio_bitrate < storage.AUDIO_BITRATE
    assert five_minutes.video_bitrate >= storage.VIDEO_MIN_BITRATE


def test_encode_plan_never_upscales():
    assert storage.plan_video_encode(10.0, 640, 30.0).max_side == 640


def test_encode_plan_rejects_videos_too_long_for_whatsapp():
    with pytest.raises(storage.VideoCompressionError, match="largo"):
        storage.plan_video_encode(3600.0, 1920, 30.0)
    with pytest.raises(storage.VideoCompressionError):
        storage.plan_video_encode(0.0, 1920, 30.0)


@requires_ffmpeg
def test_compress_video_fits_a_small_limit_with_lower_quality():
    """La recompresión apunta al límite que se le pide: un clip que no entra
    en 60 KB a bitrate normal sale más chico, y sigue siendo H.264/AAC."""
    h264 = _ffmpeg_video("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac")
    limit = 60 * 1024

    converted = storage.compress_video(h264, limit)

    assert len(converted) <= limit
    assert storage.video_is_whatsapp_compatible(converted) is True


def test_upload_keeps_original_video_when_conversion_fails(monkeypatch):
    saved = {}

    def fake_save(filename, data, content_type):
        saved.update(data=data, content_type=content_type)
        return f"/media/{filename}"

    def failing_compress(_raw, _max):
        raise storage.VideoCompressionError("boom")

    monkeypatch.setattr(media_upload, "save_media_bytes", fake_save)
    monkeypatch.setattr(media_upload, "video_is_whatsapp_compatible", lambda _raw: False)
    monkeypatch.setattr(media_upload, "compress_video", failing_compress)

    media_upload.save_decoded_media("video/mp4", b"original-video", "clip.mp4")

    assert saved == {"data": b"original-video", "content_type": "video/mp4"}


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


def test_minio_object_removed_between_stat_and_read_raises_not_found(media_dir, monkeypatch):
    """Regresión: get_object() fallando con NoSuchKey después de un stat_object()
    exitoso debía traducirse a MediaNotFoundError, pero un rename de parámetro en
    ``_iter_minio`` dejó una referencia a una variable inexistente que producía un
    NameError sin controlar (y una respuesta HTTP truncada en el navegador)."""
    class FlakyMinio(FakeMinio):
        def get_object(self, bucket, object_name, offset=0, length=0):
            raise FakeS3Error("NoSuchKey")

    fake = FlakyMinio()
    configure_minio(monkeypatch, fake)
    url = storage.save_media_bytes("photo.jpg", b"pixels", "image/jpeg")

    with pytest.raises(storage.MediaNotFoundError):
        b"".join(storage.iter_media(url))


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

    monkeypatch.setattr(media_upload, "save_media_bytes", fake_save)
    result = media_upload.save_media_file(
        "audio/webm;codecs=opus",
        base64.b64encode(b"webm-audio").decode("ascii"),
    )

    assert result.endswith(".weba")
    assert saved["filename"].endswith(".weba")
    assert saved["content_type"] == "audio/webm"


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


def test_minio_http_client_has_timeouts():
    """El pool del SDK debe traer timeout explícito.

    Sin él una conexión colgada no se corta nunca, y como el SDK es síncrono
    cada llamada retiene un hilo del threadpool de anyio: suficientes
    descargas atascadas y el proceso deja de atender los endpoints `def`.
    """
    pool_kwargs = storage._minio_http_client().connection_pool_kw
    timeout = pool_kwargs["timeout"]
    assert timeout.connect_timeout == storage.settings.minio_connect_timeout_seconds
    assert timeout.read_timeout == storage.settings.minio_read_timeout_seconds


def test_minio_http_client_verifies_certificates_by_default():
    """`cert_check` del SDK se ignora al pasar http_client propio.

    La verificación pasa a depender de `cert_reqs` del pool, así que el valor
    de MINIO_VERIFY_TLS tiene que llegar hasta ahí.
    """
    assert storage._minio_http_client().connection_pool_kw["cert_reqs"] == "CERT_REQUIRED"


def test_minio_http_client_can_disable_verification(monkeypatch):
    monkeypatch.setattr(storage.settings, "minio_verify_tls", False)
    assert storage._minio_http_client().connection_pool_kw["cert_reqs"] == "CERT_NONE"


def test_download_content_disposition_preserves_utf8_and_removes_paths():
    header = media._content_disposition('../fólder\\resultado final.jpg')

    assert header.startswith('attachment; filename="resultado final.jpg";')
    assert "filename*=UTF-8''resultado%20final.jpg" in header
    assert "folder" not in header
