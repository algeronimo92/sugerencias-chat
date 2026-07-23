"""El parser de MP4 debe extraer las dimensiones de presentación del tkhd,
incluyendo videos portrait que vienen rotados por matriz (teléfonos)."""

import struct

from services.media_storage import _mp4_dimensions

IDENTITY_MATRIX = struct.pack(
    ">9i", 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000
)
# Rotación de 90°: a y d en 0, b y c con los factores de escala.
ROTATED_MATRIX = struct.pack(
    ">9i", 0, 0x00010000, 0, -0x00010000, 0, 0, 0, 0, 0x40000000
)


def _box(box_type: bytes, payload: bytes) -> bytes:
    return (len(payload) + 8).to_bytes(4, "big") + box_type + payload


def _tkhd(width: int, height: int, matrix: bytes) -> bytes:
    payload = (
        bytes(4)          # version 0 + flags
        + bytes(20)       # creation/modification/track_id/reserved/duration
        + bytes(16)       # reserved + layer + alternate_group + volume + reserved
        + matrix
        + (width << 16).to_bytes(4, "big")
        + (height << 16).to_bytes(4, "big")
    )
    return _box(b"tkhd", payload)


def _mp4(width: int, height: int, matrix: bytes = IDENTITY_MATRIX) -> bytes:
    return _box(b"moov", _box(b"trak", _tkhd(width, height, matrix)))


class TestMp4Dimensions:
    def test_landscape(self):
        assert _mp4_dimensions(_mp4(1280, 720)) == (1280, 720)

    def test_cuadrado(self):
        assert _mp4_dimensions(_mp4(480, 480)) == (480, 480)

    def test_portrait_por_rotacion(self):
        # El teléfono graba frames landscape y marca la rotación en la matriz:
        # las dimensiones de presentación quedan intercambiadas.
        assert _mp4_dimensions(_mp4(1920, 1080, ROTATED_MATRIX)) == (1080, 1920)

    def test_ignora_pistas_sin_video(self):
        audio_trak = _box(b"trak", _tkhd(0, 0, IDENTITY_MATRIX))
        video_trak = _box(b"trak", _tkhd(640, 360, IDENTITY_MATRIX))
        data = _box(b"moov", audio_trak + video_trak)
        assert _mp4_dimensions(data) == (640, 360)

    def test_datos_invalidos(self):
        assert _mp4_dimensions(b"") is None
        assert _mp4_dimensions(b"not a real mp4 file at all") is None
