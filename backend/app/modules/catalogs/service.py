"""Comandos de etiquetas y servicios del catálogo. Renombrar un servicio
publica ``ServiceRenamed`` dentro de la misma transacción. Las lecturas
viven en queries.py."""

from __future__ import annotations

from app.core.events import dispatch_in_transaction
from app.db.uow import unit_of_work
from app.modules.catalogs import repository
from app.modules.catalogs.errors import (
    ErpManagedError,
    LeadServiceAlreadyExistsError,
    ServiceInUseError,
    ServicePackageAlreadyExistsError,
    TagAlreadyExistsError,
)
from app.modules.catalogs.events import ServiceDeletionRequested
from app.modules.catalogs.policies import count_label

__all__ = [
    "ErpManagedError",
    "LeadServiceAlreadyExistsError",
    "ServiceInUseError",
    "ServicePackageAlreadyExistsError",
    "TagAlreadyExistsError",
    "create_lead_service",
    "create_service_package",
    "create_tag",
    "delete_lead_service",
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


async def delete_lead_service(service_id: int) -> bool:
    """Borra un servicio cargado a mano que nadie usa todavía (típicamente,
    uno creado por error). False si no existe.

    Antes solo se podía desactivar, y un servicio mal escrito quedaba para
    siempre en el listado. Lo que ya se usó no se borra: levanta
    ``ServiceInUseError`` con lo que lo usa, y para eso está desactivarlo.
    Los del ERP tampoco: los vuelve a traer la próxima sincronización.
    """
    async with unit_of_work():
        service = await repository.service_origin(service_id)
        if service is None:
            return False
        if service["external_id"]:
            raise ErpManagedError(service_id)
        check = ServiceDeletionRequested(service_id=service_id, name=service["name"])
        templates = await repository.count_templates_for_service(service["name"])
        if templates:
            check.usages.append(count_label(templates, "plantilla", "plantillas"))
        # En el acto y no al cerrar la unidad de trabajo: hay que saber qué
        # lo usa antes del DELETE (ver ServiceDeletionRequested).
        await dispatch_in_transaction([check])
        if check.usages:
            raise ServiceInUseError(check.usages)
        await repository.delete_lead_service(service_id)
    return True


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
