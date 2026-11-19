"""Reglas puras para convertir lo que llega (una fila de CSV, un contacto de
Meta) en datos de agenda: teléfono E.164, etiquetas, consentimiento y la
clave que identifica a una persona dentro de una importación."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from app.core.phone_utils import PhoneValidationError, normalize_phone

MAX_TAGS = 20
MAX_TAG_LENGTH = 40
MAX_TEXT_LENGTH = 2000

_E164 = re.compile(r"[1-9]\d{7,14}")
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_TAG_SEPARATORS = re.compile(r"[,;|]")
_TRUE_WORDS = {"si", "sí", "s", "yes", "y", "true", "1", "x", "acepta", "aceptó", "acepto", "ok"}


@dataclass
class ContactDraft:
    """Lo que se va a guardar de una persona, ya limpio. ``error`` dice por qué
    no se puede importar; una fila con error se muestra pero no se elige."""

    nombre: str | None = None
    telefono: str | None = None
    wa_user_id: str | None = None
    username: str | None = None
    email: str | None = None
    notas: str | None = None
    etiquetas: list[str] = field(default_factory=list)
    consentimiento: bool = False
    ultima_interaccion_at: datetime | None = None
    error: str | None = None

    @property
    def dedupe_key(self) -> str | None:
        """Una persona aparece una vez por importación: su BSUID si se conoce
        (es lo único que Meta garantiza), si no su número."""
        if self.wa_user_id:
            return f"u:{self.wa_user_id}"
        if self.telefono:
            return f"p:{self.telefono}"
        return None


def clean_text(value: object, limit: int = MAX_TEXT_LENGTH) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text[:limit] or None


def parse_tags(value: object) -> list[str]:
    """``"vip, botox;  Botox"`` -> ``["vip", "botox"]``: sin repetidos (sin
    distinguir mayúsculas), en el orden en que aparecen."""
    if value is None:
        return []
    raw = value if isinstance(value, list) else _TAG_SEPARATORS.split(str(value))
    seen: set[str] = set()
    tags: list[str] = []
    for item in raw:
        tag = clean_text(item, MAX_TAG_LENGTH)
        if tag and tag.casefold() not in seen:
            seen.add(tag.casefold())
            tags.append(tag)
    return tags[:MAX_TAGS]


def merge_tags(current: list[str] | None, extra: list[str] | None) -> list[str]:
    return parse_tags([*(current or []), *(extra or [])])


def parse_consent(value: object) -> bool:
    return (clean_text(value) or "").casefold() in _TRUE_WORDS


def phone_from_meta(value: object) -> str | None:
    """Meta manda el número sin ``+``; uno que no parezca E.164 se descarta en
    vez de inventar un código de país."""
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if _E164.fullmatch(digits) else None


def draft_from_csv_row(values: dict[str, object], country_code: str) -> ContactDraft:
    """``values`` ya viene con las columnas mapeadas a campos de la agenda."""
    draft = ContactDraft(
        nombre=clean_text(values.get("nombre"), 200),
        email=clean_text(values.get("email"), 200),
        notas=clean_text(values.get("notas")),
        etiquetas=parse_tags(values.get("etiquetas")),
        consentimiento=parse_consent(values.get("consentimiento")),
    )
    raw_phone = clean_text(values.get("telefono"), 40)
    if not raw_phone:
        draft.error = "Sin teléfono"
        return draft
    try:
        draft.telefono = normalize_phone(raw_phone, country_code)
    except PhoneValidationError as exc:
        draft.error = str(exc)
        return draft
    if draft.email and not _EMAIL.fullmatch(draft.email):
        draft.error = "El correo no es válido"
    return draft
