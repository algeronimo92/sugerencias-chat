"""Lo que cada negocio le cuenta al asistente IA y cómo le llega al workflow.

El workflow de sugerencias es uno solo para todos los negocios y no guarda
nada propio de ninguno: en cada job pide al backend el perfil del negocio, sus
recursos, su catálogo y su conocimiento, siempre dentro del schema ligado al
token del job. Acá vive la parte de perfil, recursos y catálogo.
"""

from __future__ import annotations

from decimal import Decimal
from app.modules.ai import profile_repository
from app.modules.catalogs.ports.ai_catalog_repository import list_ai_catalog_rows
from app.modules.media.ports.ai_resources_repository import list_ai_resource_rows


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


async def get_profile() -> dict:
    return await profile_repository.get_profile(tuple(PROFILE_FIELDS))


async def update_profile(values: dict[str, str | None], user_id: int | None) -> dict:
    normalized = normalize_profile_values(values)
    return await profile_repository.save_profile(normalized, user_id, tuple(PROFILE_FIELDS))


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
    rows = await list_ai_resource_rows(MAX_AI_RESOURCES)
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
    rows = await list_ai_catalog_rows()
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
