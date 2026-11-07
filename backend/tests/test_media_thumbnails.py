"""Las miniaturas de la biblioteca pesan poco y se generan una sola vez.

La lista de "Adjuntos" mostraba cada imagen con el archivo original (PNGs de
1,7 MB): abrirla con 30 archivos bajaba decenas de MB. Acá se fija que la
miniatura cabe en 640 px, que se guarda junto al original y que el segundo
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


def test_thumbnail_fits_in_640px_and_is_saved_next_to_the_original(local_backend):
    url = storage.save_media_bytes("promo.png", _png(1600, 900), "image/png")

    thumbnail = storage.get_or_create_thumbnail(url)

    assert thumbnail.content_type == "image/webp"
    with Image.open(BytesIO(thumbnail.data)) as img:
        assert img.format == "WEBP"
        assert (img.width, img.height) == (640, 360)
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


def _pdf(width: int = 300, height: int = 500) -> bytes:
    """Un PDF de una página con un rectángulo oscuro, suficiente para renderizar."""
    content = f"0.1 0.6 0.5 rg 20 20 {width - 40} {height // 2} re f".encode()
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        + f"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 {width} {height}]/Contents 4 0 R>>endobj\n".encode()
        + f"4 0 obj<</Length {len(content)}>>stream\n".encode() + content + b"\nendstream endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )


def test_pdf_thumbnail_is_its_first_page_on_white(local_backend):
    """Una lista de precios se reconoce por su primera página, como en el Finder."""
    url = storage.save_media_bytes("precios.pdf", _pdf(300, 500), "application/pdf")

    thumbnail = storage.get_or_create_thumbnail(url)

    assert thumbnail.content_type == "image/webp"
    with Image.open(BytesIO(thumbnail.data)) as img:
        assert (img.width, img.height) == (384, 640)
        assert img.getpixel((5, 5))[:3] == (255, 255, 255)   # margen de la página, no negro
        assert img.getpixel((192, 600))[:3] != (255, 255, 255)  # el rectángulo pintado
    assert (local_backend / "precios.pdf.thumb.webp").exists()


def test_corrupt_pdf_has_no_thumbnail(local_backend):
    url = storage.save_media_bytes("roto.pdf", b"%PDF-1.4 esto no es un pdf", "application/pdf")
    with pytest.raises(storage.ThumbnailUnavailableError):
        storage.get_or_create_thumbnail(url)
    assert not (local_backend / "roto.pdf.thumb.webp").exists()


def test_audio_video_and_other_documents_have_no_thumbnail(local_backend):
    for name, content_type in (("nota.ogg", "audio/ogg"), ("clip.mp4", "video/mp4"), ("informe.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")):
        url = storage.save_media_bytes(name, b"contenido", content_type)
        with pytest.raises(storage.ThumbnailUnavailableError):
            storage.get_or_create_thumbnail(url)
        assert not (local_backend / f"{name}.thumb.webp").exists()


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
        assert img.width == 640


@pytest.mark.parametrize("filename", ["no-existe.png", "nota.ogg"])
def test_endpoint_answers_404_without_thumbnail(local_backend, filename):
    storage.save_media_bytes("nota.ogg", b"OggS", "audio/ogg")
    with pytest.raises(HTTPException) as excinfo:
        media.get_media_thumbnail(filename)
    assert excinfo.value.status_code == 404
