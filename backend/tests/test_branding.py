"""Marca por negocio: lo que el operador carga y lo que ve el CRM."""

import base64
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi import HTTPException, Response
from PIL import Image

from app.modules.platform import branding_api as branding_router
from app.modules.platform import api as platform
from app.modules.platform import branding

ORG_ID = UUID("68b010ae-8f9b-4f47-ab57-c74048923081")


def _png(width: int, height: int, color=(200, 30, 60, 255)) -> bytes:
    buffer = BytesIO()
    Image.new("RGBA", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_color_is_normalized_and_must_keep_white_text_legible():
    assert branding.normalize_color("#1E40AF") == "#1e40af"
    assert branding.normalize_color("00a884") == "#00a884"
    assert branding.normalize_color("  ") is None

    with pytest.raises(ValueError, match="muy claro"):
        branding.normalize_color("#ffe066")
    with pytest.raises(ValueError, match="#RRGGBB"):
        branding.normalize_color("azul")


def test_platform_default_color_meets_its_own_minimum():
    assert branding.contrast_with_white(branding.DEFAULT_COLOR) >= branding.MIN_CONTRAST_WITH_WHITE


def test_logo_becomes_square_png_in_both_sizes():
    logo, icon = branding.process_logo(_png(800, 300))

    for data, size in ((logo, branding.LOGO_SIZE), (icon, branding.ICON_SIZE)):
        with Image.open(BytesIO(data)) as image:
            assert image.format == "PNG"
            assert image.size == (size, size)
            # El logo apaisado queda centrado con relleno transparente.
            assert image.getpixel((0, 0))[3] == 0


def test_logo_rejects_svg_and_oversized_files():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    with pytest.raises(ValueError, match="no es una imagen"):
        branding.process_logo(svg)
    with pytest.raises(ValueError, match="2 MB"):
        branding.process_logo(b"0" * (branding.MAX_LOGO_BYTES + 1))
    with pytest.raises(ValueError, match="px de lado"):
        branding.process_logo(_png(branding.MAX_LOGO_SIDE + 1, 10))


def test_manifest_uses_business_name_color_and_logo():
    custom = branding.Branding(name="Clínica Norte Premium", primary_color="#1e40af", has_logo=True, version=7)

    manifest = branding.web_manifest(custom)

    assert manifest["name"] == "Clínica Norte Premium"
    assert len(manifest["short_name"]) <= 12
    assert manifest["theme_color"] == "#1e40af"
    assert {icon["src"] for icon in manifest["icons"]} == {
        "/api/branding/logo?size=192&v=7",
        "/api/branding/logo?size=512&v=7",
    }


def test_manifest_without_logo_keeps_platform_icons():
    icons = branding.web_manifest(branding.DEFAULT_BRANDING)["icons"]
    assert any(icon["purpose"] == "maskable" for icon in icons)


async def test_public_branding_resolves_the_business_from_the_domain(monkeypatch):
    monkeypatch.setattr(branding_router, "get_current_tenant", lambda: SimpleNamespace(organization_id=ORG_ID))
    lookup = AsyncMock(return_value=branding.Branding("Clínica Norte", "#1e40af", True, 3))
    monkeypatch.setattr(branding_router, "get_branding", lookup)

    result = await branding_router.read_branding(Response())

    lookup.assert_awaited_once_with(ORG_ID)
    assert result == {
        "name": "Clínica Norte",
        "primary_color": "#1e40af",
        "logo_url": "/api/branding/logo?size=512&v=3",
        "icon_url": "/api/branding/logo?size=192&v=3",
    }


async def test_public_branding_without_business_is_the_platform_brand(monkeypatch):
    monkeypatch.setattr(branding_router, "get_current_tenant", lambda: None)

    result = await branding_router.read_branding(Response())

    assert result["name"] == branding.PLATFORM_NAME
    assert result["logo_url"] is None


async def test_logo_only_offers_the_generated_sizes(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        await branding_router.read_logo(size=64)
    assert exc.value.status_code == 400


async def test_platform_rejects_a_color_that_breaks_contrast(monkeypatch):
    monkeypatch.setattr(branding, "_upsert", AsyncMock(side_effect=AssertionError("no debería guardar")))

    with pytest.raises(HTTPException) as exc:
        await platform.put_organization_branding(
            ORG_ID, platform.BrandingBody(display_name="Clínica", primary_color="#fff3b0")
        )

    assert exc.value.status_code == 422
    assert "muy claro" in exc.value.detail


async def test_platform_rejects_logo_that_is_not_base64(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        await platform.put_organization_logo(ORG_ID, platform.BrandingLogoBody(data_base64="%%%"))
    assert exc.value.status_code == 422


async def test_platform_stores_a_valid_logo(monkeypatch):
    stored = {}

    async def fake_upsert(organization_id, values):
        stored.update(values)

    monkeypatch.setattr(branding, "_upsert", fake_upsert)
    monkeypatch.setattr(branding, "get_branding", AsyncMock(return_value=branding.Branding("Clínica", "#00a884", True, 1)))
    monkeypatch.setattr(branding, "get_raw_branding", AsyncMock(return_value={}))

    result = await platform.put_organization_logo(
        ORG_ID, platform.BrandingLogoBody(data_base64=base64.b64encode(_png(64, 64)).decode())
    )

    assert result["has_logo"] is True
    assert set(stored) == {"logo_png", "icon_png"}
