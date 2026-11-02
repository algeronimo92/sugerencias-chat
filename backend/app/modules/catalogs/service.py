"""Comandos de etiquetas y servicios del catálogo. Renombrar un servicio
publica ``ServiceRenamed`` dentro de la misma transacción. Las lecturas
viven en queries.py."""

from __future__ import annotations

from app.db.uow import unit_of_work
from app.modules.catalogs import repository
from app.modules.catalogs.errors import LeadServiceAlreadyExistsError, TagAlreadyExistsError

__all__ = [
    "LeadServiceAlreadyExistsError",
    "TagAlreadyExistsError",
    "create_lead_service",
    "create_tag",
    "update_lead_service",
    "update_tag",
]


async def create_lead_service(name: str, user_id: int) -> dict:
    async with unit_of_work():
        return await repository.create_lead_service(name, user_id)


async def update_lead_service(service_id: int, values: dict, actor_user_id: int | None = None) -> dict | None:
    async with unit_of_work():
        return await repository.update_lead_service(service_id, values, actor_user_id)


async def create_tag(name: str, color: str, user_id: int) -> dict:
    async with unit_of_work():
        return await repository.create_tag(name, color, user_id)


async def update_tag(tag_id: int, values: dict) -> dict | None:
    async with unit_of_work():
        return await repository.update_tag(tag_id, values)
