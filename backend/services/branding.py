"""Marca de cada negocio: nombre visible, color principal y logo.

La carga el operador desde el panel de plataforma y el CRM la lee antes del
login, resolviendo el negocio por el dominio. Sin marca propia, el negocio se
ve con el color y los íconos de la plataforma y el nombre de su organización.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from uuid import UUID

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import Organization, OrganizationBranding
from db.session import control_session

PLATFORM_NAME = "Cliniventas"
DEFAULT_COLOR = "#00a884"
MAX_NAME_LENGTH = 60
MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_LOGO_SIDE = 4096
LOGO_SIZE = 512
ICON_SIZE = 192
# Solo mapas de bits: un SVG puede traer scripts y se serviría desde el
# origen autenticado del CRM (hallazgo H06 de la auditoría).
_ALLOWED_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})
# Los botones y badges del CRM usan texto blanco sobre el color principal.
# 3:1 es el mínimo WCAG para texto grande o en negrita y controles, y es el
# nivel del verde original (#00a884 ≈ 3.03:1).
MIN_CONTRAST_WITH_WHITE = 3.0
_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


class OrganizationNotFound(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Branding:
    name: str
    primary_color: str
    has_logo: bool
    version: int

    def as_public_dict(self) -> dict:
        logo = f"/api/branding/logo?size={LOGO_SIZE}&v={self.version}" if self.has_logo else None
        icon = f"/api/branding/logo?size={ICON_SIZE}&v={self.version}" if self.has_logo else None
        return {
            "name": self.name,
            "primary_color": self.primary_color,
            "logo_url": logo,
            "icon_url": icon,
        }


DEFAULT_BRANDING = Branding(name=PLATFORM_NAME, primary_color=DEFAULT_COLOR, has_logo=False, version=0)


def _relative_luminance(hex_color: str) -> float:
    channels = []
    for index in (1, 3, 5):
        value = int(hex_color[index:index + 2], 16) / 255
        channels.append(value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4)
    red, green, blue = channels
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_with_white(hex_color: str) -> float:
    return 1.05 / (_relative_luminance(hex_color) + 0.05)


def normalize_color(value: str | None) -> str | None:
    """``None`` o vacío vuelve al color de la plataforma."""

    if value is None or not value.strip():
        return None
    match = _HEX_RE.fullmatch(value.strip())
    if not match:
        raise ValueError("El color debe tener el formato #RRGGBB")
    color = f"#{match.group(1).lower()}"
    ratio = contrast_with_white(color)
    if ratio < MIN_CONTRAST_WITH_WHITE:
        raise ValueError(
            f"El color {color} es muy claro: el texto blanco de los botones quedaría "
            f"ilegible (contraste {ratio:.1f}:1, mínimo {MIN_CONTRAST_WITH_WHITE:.0f}:1). "
            "Elige un tono más oscuro."
        )
    return color


def normalize_name(value: str | None) -> str | None:
    name = " ".join((value or "").split())
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"El nombre visible supera los {MAX_NAME_LENGTH} caracteres")
    return name or None


def _square_png(image: Image.Image, size: int) -> bytes:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fitted = ImageOps.contain(image, (size, size), Image.Resampling.LANCZOS)
    canvas.paste(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2), fitted)
    buffer = BytesIO()
    canvas.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def process_logo(raw: bytes) -> tuple[bytes, bytes]:
    """Valida el archivo y lo deja en PNG cuadrado de 512 y 192 px.

    Reencodear descarta metadatos (EXIF con ubicación, por ejemplo) y
    cualquier contenido que no sea la imagen misma.
    """

    if not raw:
        raise ValueError("El logo está vacío")
    if len(raw) > MAX_LOGO_BYTES:
        raise ValueError("El logo supera los 2 MB")
    try:
        with Image.open(BytesIO(raw)) as probe:
            if probe.format not in _ALLOWED_FORMATS:
                raise ValueError("El logo debe ser PNG, JPG o WEBP")
            if max(probe.size) > MAX_LOGO_SIDE:
                raise ValueError(f"El logo supera los {MAX_LOGO_SIDE} px de lado")
            image = ImageOps.exif_transpose(probe).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("El archivo no es una imagen válida") from exc
    return _square_png(image, LOGO_SIZE), _square_png(image, ICON_SIZE)


def _version(updated_at: datetime | None) -> int:
    return int(updated_at.timestamp()) if updated_at else 0


async def get_branding(organization_id: UUID | str) -> Branding:
    async with control_session() as session:
        row = (
            await session.execute(
                select(
                    Organization.name,
                    OrganizationBranding.display_name,
                    OrganizationBranding.primary_color,
                    OrganizationBranding.logo_png.is_not(None).label("has_logo"),
                    OrganizationBranding.updated_at,
                )
                .outerjoin(
                    OrganizationBranding,
                    OrganizationBranding.organization_id == Organization.id,
                )
                .where(Organization.id == str(organization_id))
            )
        ).first()
    if row is None:
        raise OrganizationNotFound(str(organization_id))
    return Branding(
        name=row.display_name or row.name,
        primary_color=row.primary_color or DEFAULT_COLOR,
        has_logo=bool(row.has_logo),
        version=_version(row.updated_at),
    )


async def get_raw_branding(organization_id: UUID | str) -> dict:
    """Lo que el operador cargó, sin los valores por defecto aplicados."""

    async with control_session() as session:
        row = (
            await session.execute(
                select(OrganizationBranding.display_name, OrganizationBranding.primary_color).where(
                    OrganizationBranding.organization_id == str(organization_id)
                )
            )
        ).first()
    return {"display_name": row.display_name, "primary_color": row.primary_color} if row else {}


async def get_logo(organization_id: UUID | str, size: int) -> bytes | None:
    column = OrganizationBranding.icon_png if size == ICON_SIZE else OrganizationBranding.logo_png
    async with control_session() as session:
        return await session.scalar(
            select(column).where(OrganizationBranding.organization_id == str(organization_id))
        )


async def _upsert(organization_id: UUID | str, values: dict) -> None:
    async with control_session() as session:
        if await session.get(Organization, str(organization_id)) is None:
            raise OrganizationNotFound(str(organization_id))
        values = {**values, "updated_at": datetime.now(timezone.utc)}
        await session.execute(
            pg_insert(OrganizationBranding)
            .values(organization_id=str(organization_id), **values)
            .on_conflict_do_update(
                index_elements=[OrganizationBranding.organization_id], set_=values
            )
        )


async def update_branding(
    organization_id: UUID | str, *, display_name: str | None, primary_color: str | None
) -> Branding:
    await _upsert(
        organization_id,
        {"display_name": normalize_name(display_name), "primary_color": normalize_color(primary_color)},
    )
    return await get_branding(organization_id)


async def set_logo(organization_id: UUID | str, raw: bytes) -> Branding:
    logo, icon = process_logo(raw)
    await _upsert(organization_id, {"logo_png": logo, "icon_png": icon})
    return await get_branding(organization_id)


async def remove_logo(organization_id: UUID | str) -> Branding:
    await _upsert(organization_id, {"logo_png": None, "icon_png": None})
    return await get_branding(organization_id)


def web_manifest(branding: Branding) -> dict:
    """Manifest de la PWA con el nombre, el color y el ícono del negocio."""

    if branding.has_logo:
        icons = [
            {
                "src": f"/api/branding/logo?size={size}&v={branding.version}",
                "sizes": f"{size}x{size}",
                "type": "image/png",
                "purpose": "any",
            }
            for size in (ICON_SIZE, LOGO_SIZE)
        ]
    else:
        icons = [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ]
    return {
        "name": branding.name,
        "short_name": branding.name[:12],
        "description": "Chats de WhatsApp, leads y sugerencias con IA",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#f0f2f5",
        "theme_color": branding.primary_color,
        "icons": icons,
    }
