"""Cada lectura de multimedia debe costar el mínimo de viajes al almacenamiento.

Con la aplicación y MinIO en regiones distintas, cada `stat_object` es un
roundtrip de ~100 ms y cada cliente nuevo añade un handshake TLS. El código
original pagaba ambos varias veces por archivo:

- `read_media_bytes` hacía tres `stat_object` (el suyo, el de `iter_media` y
  el de la llamada interna de esta);
- `video_dimensions` repetía el stat en cada una de sus hasta 32 lecturas por
  rango;
- `image_dimensions` descargaba el archivo entero para leer una cabecera;
- `get_minio_client` construía un cliente nuevo en cada llamada.

Estos tests fijan el número de viajes, que es lo que se degrada sin que nada
falle de forma visible.
"""

import hashlib

import pytest

from services import media_storage as storage
from tests.test_media_dimensions import IDENTITY_MATRIX, _box, _tkhd
from tests.test_media_storage import FakeMinio, configure_minio, media_dir  # noqa: F401


def _minimal_mp4(width: int, height: int) -> bytes:
    """MP4 mínimo: un ftyp por delante y el moov con las dimensiones."""
    return _box(b"ftyp", b"isom" + b"\x00" * 8) + _box(
        b"moov", _box(b"trak", _tkhd(width, height, IDENTITY_MATRIX))
    )


class CountingMinio(FakeMinio):
    """FakeMinio que lleva la cuenta de llamadas a la red."""

    def __init__(self) -> None:
        super().__init__()
        self.stat_calls = 0
        self.get_calls = 0
        self.ranges: list[tuple[int, int]] = []

    def stat_object(self, bucket, object_name):
        self.stat_calls += 1
        return super().stat_object(bucket, object_name)

    def get_object(self, bucket, object_name, offset=0, length=0):
        self.get_calls += 1
        self.ranges.append((offset, length))
        return super().get_object(bucket, object_name, offset=offset, length=length)


@pytest.fixture
def counting(media_dir, monkeypatch) -> CountingMinio:  # noqa: F811
    fake = CountingMinio()
    configure_minio(monkeypatch, fake)
    return fake


def test_read_media_bytes_stats_once(counting: CountingMinio) -> None:
    url = storage.save_media_bytes("nota.ogg", b"abcdefghij", "audio/ogg")
    counting.stat_calls = 0
    counting.get_calls = 0

    assert storage.read_media_bytes(url) == b"abcdefghij"
    assert counting.stat_calls == 1
    assert counting.get_calls == 1


def test_serving_a_file_reuses_the_stat(counting: CountingMinio) -> None:
    """El router hace stat para las cabeceras; el streaming no debe repetirlo."""
    url = storage.save_media_bytes("foto.jpg", b"0123456789", "image/jpeg")
    counting.stat_calls = 0

    info = storage.stat_media(url)
    body = b"".join(storage.iter_media_stat(info, url, 2, 5))

    assert body == b"23456"
    assert counting.stat_calls == 1


def test_image_dimensions_reads_only_a_header(counting: CountingMinio) -> None:
    """Una imagen grande no debe descargarse entera para medirla."""
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (640, 480), "white").save(buffer, format="PNG")
    payload = buffer.getvalue() + b"\x00" * (storage.IMAGE_HEADER_BYTES * 2)

    url = storage.save_media_bytes("grande.png", payload, "image/png")
    counting.stat_calls = 0
    counting.ranges.clear()

    assert storage.image_dimensions(url) == (640, 480)
    assert counting.stat_calls == 1
    # El primer rango pedido debe ser la cabecera, no el archivo completo.
    assert counting.ranges[0][1] == storage.IMAGE_HEADER_BYTES
    assert counting.ranges[0][1] < len(payload)


def test_image_dimensions_falls_back_to_the_whole_file(counting: CountingMinio) -> None:
    """Si la cabecera no alcanza, se reintenta entera en vez de fallar."""
    from io import BytesIO

    from PIL import Image

    monkeypatched_header = 8  # tan pequeño que PIL no puede medir con eso
    buffer = BytesIO()
    Image.new("RGB", (32, 24), "white").save(buffer, format="PNG")
    payload = buffer.getvalue()

    url = storage.save_media_bytes("chica.png", payload, "image/png")
    original = storage.IMAGE_HEADER_BYTES
    try:
        storage.IMAGE_HEADER_BYTES = monkeypatched_header
        assert storage.image_dimensions(url) == (32, 24)
    finally:
        storage.IMAGE_HEADER_BYTES = original


def test_video_dimensions_stats_once(counting: CountingMinio) -> None:
    """Recorrer los boxes de un MP4 no debe re-consultar el objeto por rango."""
    moov = _minimal_mp4(width=1280, height=720)
    url = storage.save_media_bytes("clip.mp4", moov, "video/mp4")
    counting.stat_calls = 0

    assert storage.video_dimensions(url) == (1280, 720)
    assert counting.stat_calls == 1


def test_uploaded_bytes_are_unchanged(counting: CountingMinio) -> None:
    """Red de seguridad: optimizar lecturas no puede alterar el contenido."""
    payload = b"contenido-intacto" * 100
    url = storage.save_media_bytes("doc.pdf", payload, "application/pdf")

    assert storage.read_media_bytes(url) == payload
    stored = next(iter(counting.objects.values()))
    assert stored["data"] == payload
    assert stored["metadata"]["x-amz-meta-sha256"] == hashlib.sha256(payload).hexdigest()
