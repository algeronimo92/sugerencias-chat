"""Lo que cada negocio le cuenta al asistente IA y cómo le llega al workflow.

El workflow de sugerencias es uno solo para todos los negocios y no guarda
nada propio de ninguno: en cada job pide al backend el perfil del negocio, sus
recursos, su catálogo y su conocimiento, siempre dentro del schema ligado al
token del job. Acá vive la parte de perfil, recursos y catálogo.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select, true
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import AIProfile, LeadService, MediaAsset
from db.session import get_sessionmaker

# Campo -> largo máximo. Son datos acotados del negocio, no un prompt libre:
# el prompt base del copiloto (identidad, aislamiento, formato) es de la
# plataforma y un negocio no puede reemplazarlo desde acá.
PROFILE_FIELDS: dict[str, int] = {
    "business_name": 120,
    "business_description": 2000,
    "location": 500,
    "opening_hours": 500,
    "currency": 10,
    "tone": 300,
    "always_rules": 2000,
    "never_rules": 2000,
}
MAX_RULES = 20
MAX_AI_RESOURCES = 50


def _clean_multiline(value: str) -> str:
    lines = [" ".join(line.split()) for line in value.replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


def normalize_profile_values(values: dict[str, str | None]) -> dict[str, str | None]:
    unknown = set(values) - set(PROFILE_FIELDS)
    if unknown:
        raise ValueError(f"Campos desconocidos: {', '.join(sorted(unknown))}")
    normalized: dict[str, str | None] = {}
    for key, raw in values.items():
        text = _clean_multiline(raw or "")
        text = "".join(ch for ch in text if ch == "\n" or ch.isprintable())
        if len(text) > PROFILE_FIELDS[key]:
            raise ValueError(f"El campo {key} supera los {PROFILE_FIELDS[key]} caracteres")
        if key == "currency":
            text = text.upper()
        normalized[key] = text or None
    for key in ("always_rules", "never_rules"):
        if normalized.get(key) and len(split_rules(normalized[key])) > MAX_RULES:
            raise ValueError(f"Máximo {MAX_RULES} reglas por lista")
    return normalized


def split_rules(value: str | None) -> list[str]:
    """Una regla por línea; se toleran viñetas pegadas desde otro documento."""

    rules = []
    for line in (value or "").split("\n"):
        rule = line.strip().lstrip("-*•·").strip()
        if rule:
            rules.append(rule)
    return rules


def _profile_dict(row: AIProfile | None) -> dict:
    values = {key: getattr(row, key) if row is not None else None for key in PROFILE_FIELDS}
    updated_at = row.updated_at if row is not None else None
    return {
        **values,
        "updated_at": updated_at.isoformat().replace("+00:00", "Z") if updated_at else None,
    }


async def get_profile() -> dict:
    async with get_sessionmaker()() as session:
        row = await session.get(AIProfile, 1)
        return _profile_dict(row)


async def update_profile(values: dict[str, str | None], user_id: int | None) -> dict:
    normalized = normalize_profile_values(values)
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        statement = pg_insert(AIProfile).values(
            id=1, **normalized, updated_by=user_id, updated_at=now
        )
        statement = statement.on_conflict_do_update(
            index_elements=[AIProfile.id],
            set_={**normalized, "updated_by": user_id, "updated_at": now},
        )
        await session.execute(statement)
        await session.commit()
    return await get_profile()


def build_tenant_config(profile: dict) -> dict:
    """Perfil en la forma que consume el prompt: sin claves vacías."""

    business_fields = {
        "nombre": "business_name",
        "descripcion": "business_description",
        "ubicacion": "location",
        "horarios": "opening_hours",
    }
    business = {label: profile[key] for label, key in business_fields.items() if profile.get(key)}
    config: dict = {}
    if business:
        config["negocio"] = business
    if profile.get("currency"):
        config["moneda"] = profile["currency"]
    if profile.get("tone"):
        config["tono"] = profile["tone"]
    always = split_rules(profile.get("always_rules"))
    never = split_rules(profile.get("never_rules"))
    if always or never:
        config["reglas"] = {"siempre": always, "nunca": never}
    return config


async def fetch_tenant_config() -> dict:
    return build_tenant_config(await get_profile())


async def list_ai_resources() -> list[dict]:
    """Archivos de la biblioteca que el negocio describió para el asistente."""

    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                select(
                    MediaAsset.id,
                    MediaAsset.filename,
                    MediaAsset.content_type,
                    MediaAsset.media_url,
                    MediaAsset.ai_description,
                )
                .where(func.length(func.btrim(func.coalesce(MediaAsset.ai_description, ""))) > 0)
                .order_by(MediaAsset.created_at.desc(), MediaAsset.id.desc())
                .limit(MAX_AI_RESOURCES)
            )
        ).mappings().all()
    return [
        {
            "id": row["id"],
            "nombre": row["filename"],
            "tipo": row["content_type"],
            "url": row["media_url"],
            "descripcion": row["ai_description"],
        }
        for row in rows
    ]


def _price(value: Decimal | None) -> str | None:
    return None if value is None else f"{value:.2f}"


async def list_ai_catalog() -> list[dict]:
    """Servicios activos con lo que el asistente necesita para cotizar."""

    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                select(
                    LeadService.id,
                    LeadService.name,
                    LeadService.description,
                    LeadService.price,
                    LeadService.price_notes,
                )
                .where(LeadService.is_active == true())
                .order_by(func.lower(LeadService.name).asc())
            )
        ).mappings().all()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "price": _price(row["price"]),
            "price_notes": row["price_notes"],
        }
        for row in rows
    ]
