"""Comandos de etiquetas y servicios del catálogo. Renombrar un servicio
publica ``ServiceRenamed`` dentro de la misma transacción. Las lecturas
viven en queries.py."""

from __future__ import annotations

from dataclasses import dataclass, replace

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
from app.modules.catalogs.policies import describe_usage

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
    "service_usage",
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


@dataclass(frozen=True)
class ServiceUsageReport:
    """Lo que impide borrar el servicio (``usages``) y lo que no lo impide
    pero cambia al borrarlo (``notices``, cada uno con su ``detail``)."""

    usages: list
    notices: list


# Cuántos servicios nombrar en el aviso; con más se dice "y otros".
_LISTED_SERVICES = 3


async def _with_outcome(notice, service_id: int, name: str):
    """Qué pasa con las reglas que filtran por el nombre: el filtro es un
    texto que se busca dentro del servicio de interés, así que puede seguir
    coincidiendo con otro servicio (borrar "Hollywood Peel" no frena una regla
    que también atrapa "Hollywood Peel - Rostro")."""
    others = await repository.other_services_containing(name, service_id, limit=_LISTED_SERVICES + 1)
    if others:
        listed = ", ".join(f"«{other}»" for other in others[:_LISTED_SERVICES])
        if len(others) > _LISTED_SERVICES:
            listed += " y otros"
        detail = f"Seguirán aplicándose a los leads con {listed}, que también contienen «{name}»."
    else:
        detail = f"Ningún otro servicio del catálogo contiene «{name}»: dejarán de aplicarse, salvo que un lead lo tenga escrito a mano."
    return replace(notice, detail=detail)


async def _usages(service_id: int, name: str) -> ServiceUsageReport:
    """Qué nombra al servicio: sus plantillas y lo que anotan los módulos que
    lo usan (``ServiceDeletionRequested``). Se despacha en el acto y no al
    cerrar la unidad de trabajo: hay que saberlo antes de cualquier DELETE."""
    check = ServiceDeletionRequested(service_id=service_id, name=name)
    templates, examples = await repository.templates_for_service(name)
    if templates:
        check.usages.append(describe_usage("plantillas", templates, "plantilla", "plantillas", examples))
    await dispatch_in_transaction([check])
    notices = [await _with_outcome(notice, service_id, name) for notice in check.notices]
    return ServiceUsageReport(usages=check.usages, notices=notices)


async def service_usage(service_id: int) -> ServiceUsageReport | None:
    """Lo que usa al servicio, para mostrarlo antes de intentar borrarlo.
    None si no existe."""
    async with unit_of_work():
        service = await repository.service_origin(service_id)
        if service is None:
            return None
        return await _usages(service_id, service["name"])


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
        report = await _usages(service_id, service["name"])
        if report.usages:
            raise ServiceInUseError(report.usages)
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
