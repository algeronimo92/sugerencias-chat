"""Sincroniza el catálogo del CRM con la lista de precios del ERP del negocio.

DermicaPro ya tiene servicios y paquetes en su ERP, expuestos en una URL
pública (``/api/public/catalog``). Cargarlos otra vez en el CRM era tener
dos listas de precios: el asistente IA habría cotizado con la vieja. Acá el
ERP manda y el CRM se amolda:

- Un servicio o paquete del ERP se reconoce por ``external_id``; la primera
  vez, por nombre, para adoptar lo que el negocio ya había cargado a mano.
- Renombrar en el ERP renombra en el CRM por el mismo camino que la edición
  manual, así leads y automatizaciones siguen al servicio.
- Lo que desaparece del ERP se desactiva, nunca se borra: el historial lo
  referencia.
- Lo que el negocio cargó a mano (sin ``external_id``) no se toca. La
  descripción de los servicios tampoco: el ERP no la trae y la IA la usa.

El estado de cada pasada queda en ``app_settings`` (``erp_catalog_*``) para
el panel de catálogos y para que el worker sepa cuándo volver a pedirla. El
cliente HTTP llega inyectado (``fetch``) para poder probar la lógica sin red.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import IntegrityError

from app.db.models.catalogs import LeadService, ServicePackage
from app.db.uow import current_session, unit_of_work
from app.modules.catalogs import repository
from app.modules.catalogs.errors import LeadServiceAlreadyExistsError
from app.modules.platform.ports.settings_service import get_effective_many, update_settings

logger = logging.getLogger(__name__)

# Los precios cambian pocas veces al día; una hora de desfase es aceptable y
# el admin tiene "Sincronizar ahora" para no esperar.
SYNC_INTERVAL_SECONDS = 3600
REQUEST_TIMEOUT_SECONDS = 30.0
_SETTING_KEYS = ("erp_catalog_url", "erp_catalog_synced_at", "erp_catalog_last_error", "erp_catalog_last_summary")

Fetcher = Callable[[str], Awaitable[object]]


class ErpCatalogError(Exception):
    """El ERP no respondió o respondió algo que no es un catálogo."""


def _squash(value: str) -> str:
    return " ".join(value.split())


class ErpPackage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=120)
    label: str = Field(min_length=1, max_length=80)
    sessions: int = Field(ge=1, le=1000)
    price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)

    @field_validator("label", mode="before")
    @classmethod
    def _clean_label(cls, value):
        return _squash(value) if isinstance(value, str) else value


class ErpService(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    packages: list[ErpPackage] = Field(default_factory=list)

    @field_validator("name", mode="before")
    @classmethod
    def _clean_name(cls, value):
        return _squash(value) if isinstance(value, str) else value


class ErpCatalog(BaseModel):
    model_config = ConfigDict(extra="ignore")

    data: list[ErpService]


def parse_catalog(payload: object) -> list[ErpService]:
    """Valida el JSON del ERP. Dos servicios con el mismo nombre (sin
    distinguir mayúsculas) no caben en el catálogo del CRM: se rechaza la
    pasada entera y el error dice cuáles, para que lo arreglen en el ERP."""
    try:
        services = ErpCatalog.model_validate(payload).data
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise ErpCatalogError(f"El catálogo del ERP no tiene el formato esperado ({where}: {first['msg']})")
    seen: dict[str, str] = {}
    duplicated: list[str] = []
    for service in services:
        key = service.name.casefold()
        if key in seen:
            duplicated.append(service.name)
        seen[key] = service.name
        labels = [package.label.casefold() for package in service.packages]
        if len(labels) != len(set(labels)):
            raise ErpCatalogError(f"El servicio «{service.name}» repite el nombre de un paquete en el ERP")
    if duplicated:
        raise ErpCatalogError("El ERP repite el nombre de servicio: " + ", ".join(sorted(set(duplicated))))
    return services


async def fetch_catalog(url: str) -> object:
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=True) as client:
            response = await client.get(url, headers={"Accept": "application/json"})
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        raise ErpCatalogError(f"El ERP respondió {exc.response.status_code} al pedir el catálogo")
    except httpx.HTTPError as exc:
        raise ErpCatalogError(f"No se pudo conectar con el ERP: {exc}")
    except ValueError:
        raise ErpCatalogError("El ERP no devolvió JSON")


@dataclass
class SyncSummary:
    services_total: int = 0
    services_created: int = 0
    services_updated: int = 0
    services_deactivated: int = 0
    packages_created: int = 0
    packages_updated: int = 0
    packages_deactivated: int = 0
    # Servicios que no se pudieron aplicar (p. ej. el ERP renombró uno con el
    # nombre de otro cargado a mano). La pasada sigue con los demás.
    conflicts: list[str] = field(default_factory=list)


async def _sync_packages(session, service_id: int, packages: list[ErpPackage], summary: SyncSummary) -> None:
    rows = (
        await session.execute(
            select(
                ServicePackage.id, ServicePackage.name, ServicePackage.sessions, ServicePackage.price,
                ServicePackage.position, ServicePackage.is_active, ServicePackage.external_id,
            ).where(ServicePackage.service_id == service_id)
        )
    ).mappings().all()
    by_external = {row["external_id"]: row for row in rows if row["external_id"]}
    by_name = {row["name"].casefold(): row for row in rows}
    seen: set[int] = set()
    for position, package in enumerate(packages):
        price = package.price.quantize(Decimal("0.01"))
        row = by_external.get(package.id) or by_name.get(package.label.casefold())
        if row is None or row["id"] in seen:
            await session.execute(
                insert(ServicePackage).values(
                    service_id=service_id, name=package.label, sessions=package.sessions, price=price,
                    position=position, is_active=True, external_id=package.id,
                )
            )
            summary.packages_created += 1
            continue
        seen.add(row["id"])
        values = {}
        if row["name"] != package.label:
            values["name"] = package.label
        if row["sessions"] != package.sessions:
            values["sessions"] = package.sessions
        if row["price"] != price:
            values["price"] = price
        if row["position"] != position:
            values["position"] = position
        if not row["is_active"]:
            values["is_active"] = True
        if row["external_id"] != package.id:
            values["external_id"] = package.id
        if values:
            await session.execute(update(ServicePackage).where(ServicePackage.id == row["id"]).values(**values))
            summary.packages_updated += 1
    stale = [row["id"] for row in rows if row["id"] not in seen and row["is_active"]]
    if stale:
        await session.execute(update(ServicePackage).where(ServicePackage.id.in_(stale)).values(is_active=False))
        summary.packages_deactivated += len(stale)


async def _sync_service(session, service: ErpService, existing: dict | None, summary: SyncSummary) -> int | None:
    """Crea o alinea el servicio y devuelve su id; ``None`` si chocó con otro."""
    try:
        async with session.begin_nested():
            if existing is None:
                service_id = await session.scalar(
                    insert(LeadService)
                    .values(name=service.name, is_active=True, external_id=service.id)
                    .returning(LeadService.id)
                )
                summary.services_created += 1
            else:
                service_id = existing["id"]
                values = {}
                if existing["name"] != service.name:
                    values["name"] = service.name
                if not existing["is_active"]:
                    values["is_active"] = True
                if existing["external_id"] != service.id:
                    values["external_id"] = service.id
                if values:
                    # Por el repositorio: renombrar publica ServiceRenamed y
                    # leads y automatizaciones siguen al servicio.
                    await repository.update_lead_service(service_id, values, None)
                    summary.services_updated += 1
            await _sync_packages(session, service_id, service.packages, summary)
    except (IntegrityError, LeadServiceAlreadyExistsError):
        # El servicio sigue existiendo en el ERP: no se lo da de baja por no
        # haber podido aplicarle el cambio.
        summary.conflicts.append(service.name)
        return existing["id"] if existing is not None else None
    return service_id


async def apply_catalog(services: list[ErpService]) -> SyncSummary:
    """Aplica el catálogo del ERP en una sola transacción. El lock evita que
    el botón del admin y el worker se pisen en el mismo negocio."""
    summary = SyncSummary(services_total=len(services))
    async with unit_of_work():
        session = current_session()
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(current_schema() || :suffix))").bindparams(suffix=":erp_catalog_sync")
        )
        rows = (
            await session.execute(
                select(LeadService.id, LeadService.name, LeadService.is_active, LeadService.external_id)
            )
        ).mappings().all()
        by_external = {row["external_id"]: dict(row) for row in rows if row["external_id"]}
        by_name = {row["name"].casefold(): dict(row) for row in rows}
        seen: set[int] = set()
        for service in services:
            existing = by_external.get(service.id) or by_name.get(service.name.casefold())
            if existing is not None and existing["id"] in seen:
                # Dos entradas del ERP apuntan al mismo servicio del CRM.
                summary.conflicts.append(service.name)
                continue
            service_id = await _sync_service(session, service, existing, summary)
            if service_id is not None:
                seen.add(service_id)
        # Solo lo que administra el ERP: lo cargado a mano sigue como está.
        stale = [row["id"] for row in rows if row["external_id"] and row["id"] not in seen and row["is_active"]]
        if stale:
            await session.execute(update(LeadService).where(LeadService.id.in_(stale)).values(is_active=False))
            await session.execute(
                update(ServicePackage)
                .where(ServicePackage.service_id.in_(stale), ServicePackage.is_active == True)  # noqa: E712
                .values(is_active=False)
            )
            summary.services_deactivated += len(stale)
    return summary


def _parse_ts(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


def _validate_url(url: str) -> str:
    normalized = (url or "").strip()
    parsed = urlsplit(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ErpCatalogError("La URL del catálogo del ERP debe empezar con http:// o https://")
    return normalized


async def test_catalog(url: str | None = None, fetch: Fetcher = fetch_catalog) -> dict:
    """Prueba de conexión: pide y valida el catálogo sin tocar la base. Sirve
    para saber, antes de guardar la URL, si el ERP responde y con el formato
    esperado. Devuelve un resumen y una muestra para que el admin reconozca
    sus servicios; nunca levanta: el error va en la respuesta."""
    if url is None or not url.strip():
        url = (await get_effective_many(("erp_catalog_url",)))["erp_catalog_url"]
    try:
        url = _validate_url(url)
        services = parse_catalog(await fetch(url))
    except ErpCatalogError as exc:
        return {"ok": False, "url": (url or "").strip() or None, "error": str(exc)}
    without_packages = [service.name for service in services if not service.packages]
    return {
        "ok": True,
        "url": url,
        "error": None,
        "services_total": len(services),
        "packages_total": sum(len(service.packages) for service in services),
        "services_without_packages": without_packages[:10],
        "sample": [
            {
                "name": service.name,
                "packages": [
                    {"label": package.label, "sessions": package.sessions, "price": f"{package.price:.2f}"}
                    for package in service.packages
                ],
            }
            for service in services[:3]
        ],
    }


async def sync_status() -> dict:
    values = await get_effective_many(_SETTING_KEYS)
    summary = None
    if values["erp_catalog_last_summary"]:
        try:
            summary = json.loads(values["erp_catalog_last_summary"])
        except ValueError:
            summary = None
    return {
        "configured": bool(values["erp_catalog_url"].strip()),
        "url": values["erp_catalog_url"].strip() or None,
        "synced_at": values["erp_catalog_synced_at"] or None,
        "last_error": values["erp_catalog_last_error"] or None,
        "last_summary": summary,
    }


async def sync_catalog(fetch: Fetcher = fetch_catalog) -> dict:
    """Una pasada completa: pide, valida, aplica y deja constancia. Devuelve
    el estado resultante; levanta ``ErpCatalogError`` si no se pudo aplicar
    (y lo deja anotado igual, para que el panel lo muestre)."""
    url = (await get_effective_many(("erp_catalog_url",)))["erp_catalog_url"].strip()
    if not url:
        raise ErpCatalogError("El negocio no tiene configurada la URL del catálogo del ERP")
    now = datetime.now(timezone.utc).isoformat()
    try:
        services = parse_catalog(await fetch(url))
        summary = await apply_catalog(services)
    except ErpCatalogError as exc:
        await update_settings({"erp_catalog_last_error": str(exc)})
        raise
    await update_settings({
        "erp_catalog_synced_at": now,
        "erp_catalog_last_error": "",
        "erp_catalog_last_summary": json.dumps(asdict(summary), ensure_ascii=False),
    })
    return await sync_status()


async def erp_catalog_tick() -> None:
    """Pasada del worker: solo si hay ERP configurado y pasó el intervalo
    desde la última sincronización que terminó bien."""
    values = await get_effective_many(("erp_catalog_url", "erp_catalog_synced_at"))
    if not values["erp_catalog_url"].strip():
        return
    last = _parse_ts(values["erp_catalog_synced_at"])
    if last is not None and (datetime.now(timezone.utc) - last).total_seconds() < SYNC_INTERVAL_SECONDS:
        return
    try:
        await sync_catalog()
    except ErpCatalogError as exc:
        logger.warning("No se pudo sincronizar el catálogo del ERP: %s", exc)
