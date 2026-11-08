"""Comandos de etiquetas y servicios del catálogo. Renombrar un servicio
publica ``ServiceRenamed`` dentro de la misma transacción. Las lecturas
viven en queries.py."""

from __future__ import annotations

from app.db.uow import unit_of_work
from app.modules.catalogs import repository
from app.modules.catalogs.errors import (
    ErpManagedError,
    LeadServiceAlreadyExistsError,
    ServicePackageAlreadyExistsError,
    TagAlreadyExistsError,
)

__all__ = [
    "ErpManagedError",
    "LeadServiceAlreadyExistsError",
    "ServicePackageAlreadyExistsError",
    "TagAlreadyExistsError",
    "create_lead_service",
    "create_service_package",
    "create_tag",
    "update_lead_service",
    "update_service_package",
    "update_tag",
]


async def create_lead_service(name: str, user_id: int) -> dict:
    async with unit_of_work():
        return await repository.create_lead_service(name, user_id)


# En un servicio que administra el ERP, estos campos solo cambian
# sincronizando. La sincronización no pasa por acá: escribe en el
# repositorio, que es quien publica el renombre.
_ERP_LOCKED_FIELDS = ("name", "is_active")


async def update_lead_service(service_id: int, values: dict, actor_user_id: int | None = None) -> dict | None:
    async with unit_of_work():
        if any(key in values for key in _ERP_LOCKED_FIELDS) and await repository.is_erp_managed(service_id):
            raise ErpManagedError(service_id)
        return await repository.update_lead_service(service_id, values, actor_user_id)


async def create_service_package(service_id: int, values: dict) -> dict | None:
    async with unit_of_work():
        if await repository.is_erp_managed(service_id):
            raise ErpManagedError(service_id)
        return await repository.create_service_package(service_id, values)


async def update_service_package(service_id: int, package_id: int, values: dict) -> dict | None:
    async with unit_of_work():
        if await repository.is_erp_managed(service_id):
            raise ErpManagedError(service_id)
        return await repository.update_service_package(service_id, package_id, values)


async def create_tag(name: str, color: str, user_id: int) -> dict:
    async with unit_of_work():
        return await repository.create_tag(name, color, user_id)


async def update_tag(tag_id: int, values: dict) -> dict | None:
    async with unit_of_work():
        return await repository.update_tag(tag_id, values)
