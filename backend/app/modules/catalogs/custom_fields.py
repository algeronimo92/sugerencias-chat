import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.db.models.catalogs import CustomFieldDefinition
from app.db.models.leads import Lead
from app.db.uow import session_scope


class CustomFieldError(ValueError):
    pass


class CustomFieldAlreadyExistsError(CustomFieldError):
    pass


def _slug(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    key = re.sub(r"[^a-z0-9]+", "_", plain).strip("_")[:40]
    if not key or not key[0].isalpha():
        key = f"campo_{key}"[:40]
    return key


def _clean_options(options: list[str]) -> list[str]:
    cleaned: list[str] = []
    for option in options:
        value = " ".join(str(option).split())
        if value and value not in cleaned:
            cleaned.append(value[:120])
    return cleaned


def _item(row: CustomFieldDefinition) -> dict:
    return {
        "id": row.id,
        "entity_type": row.entity_type,
        "key": row.key,
        "label": row.label,
        "field_type": row.field_type,
        "required": row.required,
        "options": row.options or [],
        "position": row.position,
        "is_active": row.is_active,
    }


async def list_definitions(entity_type: str, *, include_inactive: bool = False) -> list[dict]:
    stmt = select(CustomFieldDefinition).where(CustomFieldDefinition.entity_type == entity_type)
    if not include_inactive:
        stmt = stmt.where(CustomFieldDefinition.is_active.is_(True))
    stmt = stmt.order_by(CustomFieldDefinition.position, CustomFieldDefinition.id)
    async with session_scope() as session:
        rows = (await session.scalars(stmt)).all()
    return [_item(row) for row in rows]


async def create_definition(values: dict) -> dict:
    values = dict(values)
    values["label"] = " ".join(values["label"].split())
    values["key"] = values.get("key") or _slug(values["label"])
    values["options"] = _clean_options(values.get("options") or [])
    if values["field_type"] == "select" and not values["options"]:
        raise CustomFieldError("Un campo de selección necesita al menos una opción")
    if values["field_type"] != "select":
        values["options"] = []
    async with session_scope() as session:
        row = CustomFieldDefinition(**values)
        session.add(row)
        try:
            await session.flush()
        except IntegrityError as exc:
            raise CustomFieldAlreadyExistsError("Ya existe un campo con esa clave") from exc
        await session.refresh(row)
        return _item(row)


async def update_definition(field_id: int, values: dict) -> dict | None:
    values = dict(values)
    if "label" in values:
        values["label"] = " ".join(values["label"].split())
    if "options" in values:
        values["options"] = _clean_options(values["options"] or [])
    async with session_scope() as session:
        row = await session.get(CustomFieldDefinition, field_id)
        if row is None:
            return None
        next_type = row.field_type
        next_options = values.get("options", row.options or [])
        if next_type == "select" and not next_options:
            raise CustomFieldError("Un campo de selección necesita al menos una opción")
        values["updated_at"] = func.now()
        await session.execute(update(CustomFieldDefinition).where(CustomFieldDefinition.id == field_id).values(**values))
        await session.flush()
        await session.refresh(row)
        return _item(row)


def _normalize_value(definition: dict, value: Any) -> Any:
    field_type = definition["field_type"]
    if value is None or value == "":
        return None
    if field_type in {"text", "textarea"}:
        result = str(value).strip()
        if len(result) > 2000:
            raise CustomFieldError(f"{definition['label']}: máximo 2000 caracteres")
        return result or None
    if field_type == "number":
        try:
            number = Decimal(str(value))
        except InvalidOperation as exc:
            raise CustomFieldError(f"{definition['label']}: ingresa un número válido") from exc
        if not number.is_finite():
            raise CustomFieldError(f"{definition['label']}: ingresa un número válido")
        return float(number)
    if field_type == "boolean":
        if isinstance(value, bool):
            return value
        if str(value).lower() in {"true", "1", "yes", "si", "sí"}:
            return True
        if str(value).lower() in {"false", "0", "no"}:
            return False
        raise CustomFieldError(f"{definition['label']}: valor sí/no inválido")
    if field_type == "select":
        result = str(value)
        if result not in definition["options"]:
            raise CustomFieldError(f"{definition['label']}: opción inválida")
        return result
    try:
        if field_type == "date":
            return date.fromisoformat(str(value)).isoformat()
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).isoformat()
    except ValueError as exc:
        raise CustomFieldError(f"{definition['label']}: fecha inválida") from exc


async def normalize_values(entity_type: str, values: dict[str, Any], *, require_required: bool) -> dict[str, Any]:
    definitions = await list_definitions(entity_type)
    by_key = {item["key"]: item for item in definitions}
    unknown = set(values) - set(by_key)
    if unknown:
        raise CustomFieldError(f"Campos desconocidos: {', '.join(sorted(unknown))}")
    normalized = {key: _normalize_value(by_key[key], value) for key, value in values.items()}
    if require_required:
        missing = [item["label"] for item in definitions if item["required"] and normalized.get(item["key"]) in (None, "")]
        if missing:
            raise CustomFieldError(f"Completa los campos obligatorios: {', '.join(missing)}")
    return {key: value for key, value in normalized.items() if value is not None}


async def get_lead_values(lead_id: str) -> dict[str, Any] | None:
    async with session_scope() as session:
        return await session.scalar(select(Lead.custom_fields).where(Lead.id == lead_id))


async def update_lead_values(lead_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    normalized = await normalize_values("lead", values, require_required=False)
    async with session_scope() as session:
        current = await session.scalar(select(Lead.custom_fields).where(Lead.id == lead_id).with_for_update())
        if current is None:
            return None
        merged = dict(current or {})
        for key in values:
            if key in normalized:
                merged[key] = normalized[key]
            else:
                merged.pop(key, None)
        await session.execute(update(Lead).where(Lead.id == lead_id).values(custom_fields=merged))
        await session.flush()
    return merged
