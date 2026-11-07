"""Las miniaturas de la biblioteca pesan poco y se generan una sola vez.

La lista de "Adjuntos" mostraba cada imagen con el archivo original (PNGs de
1,7 MB): abrirla con 30 archivos bajaba decenas de MB. Acá se fija que la
miniatura cabe en 320 px, que se guarda junto al original y que el segundo
pedido ya no vuelve a procesar la imagen.
"""

from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

from app.integrations.storage import media_storage as storage
from app.modules.media import api as media
from tests.test_media_storage import FakeMinio, configure_minio, media_dir  # noqa: F401  (fixture compartido)


def _png(width: int, height: int, mode: str = "RGB") -> bytes:
    buffer = BytesIO()
    Image.new(mode, (width, height), (200, 30, 30, 255) if mode == "RGBA" else (200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def local_backend(media_dir, monkeypatch):  # noqa: F811
    monkeypatch.setattr(storage.settings, "media_storage_backend", "local")
    return media_dir


def test_thumbnail_fits_in_320px_and_is_saved_next_to_the_original(local_backend):
    url = storage.save_media_bytes("promo.png", _png(1600, 900), "image/png")

    thumbnail = storage.get_or_create_thumbnail(url)

    assert thumbnail.content_type == "image/webp"
    with Image.open(BytesIO(thumbnail.data)) as img:
        assert img.format == "WEBP"
        assert (img.width, img.height) == (320, 180)
    assert (local_backend / "promo.png.thumb.webp").read_bytes() == thumbnail.data
    assert len(thumbnail.data) < len(_png(1600, 900))


def test_thumbnail_is_generated_only_once(local_backend, monkeypatch):
    url = storage.save_media_bytes("foto.jpg", _png(800, 800), "image/jpeg")
    first = storage.get_or_create_thumbnail(url)

    def must_not_render(_data):
        raise AssertionError("la miniatura ya existía: no debía volver a generarse")

    monkeypatch.setattr(storage, "render_image_thumbnail", must_not_render)
    assert storage.get_or_create_thumbnail(url).data == first.data


def test_small_images_are_not_upscaled(local_backend):
    url = storage.save_media_bytes("icono.png", _png(64, 48), "image/png")
    with Image.open(BytesIO(storage.get_or_create_thumbnail(url).data)) as img:
        assert (img.width, img.height) == (64, 48)


def test_transparency_survives(local_backend):
    """Un logo con fondo transparente no debe salir con fondo negro en la lista."""
    logo = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
    logo.paste((200, 30, 30, 255), (100, 100, 300, 300))
    buffer = BytesIO()
    logo.save(buffer, format="PNG")
    url = storage.save_media_bytes("logo.png", buffer.getvalue(), "image/png")

    with Image.open(BytesIO(storage.get_or_create_thumbnail(url).data)) as img:
        assert img.mode == "RGBA"
        assert img.getpixel((0, 0))[3] == 0
        assert img.getpixel((160, 160))[3] == 255


def test_non_images_have_no_thumbnail(local_backend):
    url = storage.save_media_bytes("precios.pdf", b"%PDF-1.4 no es una imagen", "application/pdf")
    with pytest.raises(storage.ThumbnailUnavailableError):
        storage.get_or_create_thumbnail(url)
    assert not (local_backend / "precios.pdf.thumb.webp").exists()


def test_corrupt_image_has_no_thumbnail(local_backend):
    url = storage.save_media_bytes("rota.png", b"no es un png", "image/png")
    with pytest.raises(storage.ThumbnailUnavailableError):
        storage.get_or_create_thumbnail(url)


def test_missing_original_is_not_found(local_backend):
    with pytest.raises(storage.MediaNotFoundError):
        storage.get_or_create_thumbnail("/media/no-existe.png")


def test_thumbnail_of_a_thumbnail_is_itself(local_backend):
    url = storage.save_media_bytes("promo.png", _png(1000, 500), "image/png")
    first = storage.get_or_create_thumbnail(url)
    assert storage.get_or_create_thumbnail(storage.thumbnail_media_url(url)).data == first.data
    assert not (local_backend / "promo.png.thumb.webp.thumb.webp").exists()


def test_deleting_the_original_deletes_its_thumbnail(local_backend):
    url = storage.save_media_bytes("promo.png", _png(1000, 500), "image/png")
    storage.get_or_create_thumbnail(url)

    storage.delete_media(url)

    assert not (local_backend / "promo.png").exists()
    assert not (local_backend / "promo.png.thumb.webp").exists()


def test_minio_stores_thumbnail_under_images_and_deletes_it_with_the_original(media_dir, monkeypatch):  # noqa: F811
    fake = FakeMinio()
    configure_minio(monkeypatch, fake)
    url = storage.save_media_bytes("promo.png", _png(1000, 500), "image/png")

    thumbnail = storage.get_or_create_thumbnail(url)

    stored = fake.objects[("crm-media", "dermicapro/images/promo.png.thumb.webp")]
    assert stored["data"] == thumbnail.data
    assert stored["content_type"] == "image/webp"
    assert not (media_dir / "promo.png.thumb.webp").exists()

    storage.delete_media(url)
    assert fake.objects == {}


def test_endpoint_serves_the_thumbnail_privately(local_backend):
    storage.save_media_bytes("promo.png", _png(1000, 500), "image/png")

    response = media.get_media_thumbnail("promo.png")

    assert response.status_code == 200
    assert response.media_type == "image/webp"
    assert response.headers["Cache-Control"] == "private, max-age=86400"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    with Image.open(BytesIO(response.body)) as img:
        assert img.width == 320


@pytest.mark.parametrize("filename", ["no-existe.png", "precios.pdf"])
def test_endpoint_answers_404_without_thumbnail(local_backend, filename):
    storage.save_media_bytes("precios.pdf", b"%PDF-1.4", "application/pdf")
    with pytest.raises(HTTPException) as excinfo:
        media.get_media_thumbnail(filename)
    assert excinfo.value.status_code == 404
