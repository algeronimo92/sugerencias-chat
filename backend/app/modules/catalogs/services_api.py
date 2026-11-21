from fastapi import APIRouter, Depends, HTTPException, Response

from app.modules.auth.public import User
from app.modules.catalogs.schemas import (
    ErpSyncStatus,
    ErpTestRequest,
    ErpTestResult,
    LeadServiceCreate,
    LeadServiceItem,
    LeadServiceUpdate,
    ServicePackageCreate,
    ServicePackageItem,
    ServicePackageUpdate,
    ServiceUsageResponse,
)
from app.modules.catalogs.erp_catalog import ErpCatalogError, sync_catalog, sync_status, test_catalog
from app.modules.auth.public import Permission, require_permission
from app.modules.catalogs.queries import list_lead_services
from app.modules.catalogs.service import (
    ErpManagedError,
    LeadServiceAlreadyExistsError,
    ServiceInUseError,
    ServicePackageAlreadyExistsError,
    create_lead_service,
    create_service_package,
    delete_lead_service,
    service_usage,
    update_lead_service,
    update_service_package,
)

require_catalogs_manage = require_permission(Permission.CATALOGS_MANAGE)
# El chat y la ficha del lead los listan para elegir.
require_leads_view = require_permission(Permission.LEADS_VIEW)

router = APIRouter(prefix="/api/services", tags=["lead-services"])


@router.get("", response_model=list[LeadServiceItem])
async def get_services(_user: User = Depends(require_leads_view)):
    return await list_lead_services()


@router.get("/all", response_model=list[LeadServiceItem])
async def get_all_services(_admin: User = Depends(require_catalogs_manage)):
    return await list_lead_services(include_inactive=True)


# Antes de ``/{service_id}``: FastAPI prueba las rutas en orden y "erp-sync"
# no es un entero.
@router.get("/erp-sync", response_model=ErpSyncStatus)
async def get_erp_sync_status(_admin: User = Depends(require_catalogs_manage)):
    return await sync_status()


@router.post("/erp-sync/test", response_model=ErpTestResult)
async def test_erp_connection(body: ErpTestRequest, _admin: User = Depends(require_catalogs_manage)):
    """Pide el catálogo y lo valida sin guardar nada: para probar una URL
    antes de conectarla."""
    return await test_catalog(body.url)


@router.post("/erp-sync", response_model=ErpSyncStatus)
async def run_erp_sync(_admin: User = Depends(require_catalogs_manage)):
    """Sincroniza ahora con el ERP. Si falla, el estado queda anotado igual."""
    try:
        return await sync_catalog()
    except ErpCatalogError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("", response_model=LeadServiceItem, status_code=201)
async def post_service(body: LeadServiceCreate, user: User = Depends(require_leads_view)):
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    try:
        return await create_lead_service(name, user.id)
    except LeadServiceAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un servicio con ese nombre")


@router.patch("/{service_id}", response_model=LeadServiceItem)
async def patch_service(
    service_id: int,
    body: LeadServiceUpdate,
    admin: User = Depends(require_catalogs_manage),
):
    values = body.model_dump(exclude_unset=True)
    if "name" in values:
        if values["name"] is None:
            raise HTTPException(status_code=400, detail="El nombre no puede ser null")
        values["name"] = " ".join(values["name"].split())
        if not values["name"]:
            raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    try:
        service = await update_lead_service(service_id, values, admin.id)
    except LeadServiceAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un servicio con ese nombre")
    except ErpManagedError:
        raise HTTPException(status_code=409, detail="Ese servicio lo administra el ERP: cámbialo allí y sincroniza")
    if service is None:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return service


def _group(usage) -> dict:
    return {"kind": usage.kind, "label": usage.label, "count": usage.count, "detail": usage.detail,
            "items": [{"id": item_id, "name": name} for item_id, name in usage.items]}


def _usage_payload(report) -> dict:
    return {"usages": [_group(usage) for usage in report.usages], "notices": [_group(notice) for notice in report.notices]}


@router.get("/{service_id}/usage", response_model=ServiceUsageResponse)
async def get_service_usage(service_id: int, _admin: User = Depends(require_catalogs_manage)):
    """Qué usa al servicio (leads, ventas, plantillas, automatizaciones,
    documentos), con algunos de cada uno para ir a revisarlos: lo muestra el
    cuadro de eliminar antes de intentarlo."""
    report = await service_usage(service_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return _usage_payload(report)


def _in_use_message(usages) -> str:
    labels = [usage.label for usage in usages]
    listed = labels[0] if len(labels) == 1 else f"{', '.join(labels[:-1])} y {labels[-1]}"
    return f"No se puede eliminar porque está en uso: {listed}. Desactívalo: deja de ofrecerse y el historial se conserva."


@router.delete("/{service_id}", status_code=204)
async def remove_service(service_id: int, _admin: User = Depends(require_catalogs_manage)):
    try:
        deleted = await delete_lead_service(service_id)
    except ErpManagedError:
        raise HTTPException(status_code=409, detail="Ese servicio lo administra el ERP: dalo de baja allí y sincroniza")
    except ServiceInUseError as exc:
        raise HTTPException(status_code=409, detail=_in_use_message(exc.usages))
    if not deleted:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return Response(status_code=204)


def _clean_package_values(values: dict) -> dict:
    if "name" in values:
        values["name"] = " ".join((values["name"] or "").split())
        if not values["name"]:
            raise HTTPException(status_code=400, detail="El nombre del paquete es obligatorio")
    if "notes" in values:
        values["notes"] = " ".join((values["notes"] or "").split()) or None
    return values


@router.post("/{service_id}/packages", response_model=ServicePackageItem, status_code=201)
async def post_service_package(
    service_id: int,
    body: ServicePackageCreate,
    _admin: User = Depends(require_catalogs_manage),
):
    values = _clean_package_values(body.model_dump())
    try:
        package = await create_service_package(service_id, values)
    except ServicePackageAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ese servicio ya tiene un paquete con ese nombre")
    except ErpManagedError:
        raise HTTPException(status_code=409, detail="Los paquetes de ese servicio los administra el ERP: cámbialos allí y sincroniza")
    if package is None:
        raise HTTPException(status_code=404, detail="Servicio no encontrado")
    return package


@router.patch("/{service_id}/packages/{package_id}", response_model=ServicePackageItem)
async def patch_service_package(
    service_id: int,
    package_id: int,
    body: ServicePackageUpdate,
    _admin: User = Depends(require_catalogs_manage),
):
    values = _clean_package_values(body.model_dump(exclude_unset=True))
    if "price" in values and values["price"] is None:
        raise HTTPException(status_code=400, detail="El paquete necesita un precio")
    if "sessions" in values and values["sessions"] is None:
        raise HTTPException(status_code=400, detail="El paquete necesita un número de sesiones")
    try:
        package = await update_service_package(service_id, package_id, values)
    except ServicePackageAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ese servicio ya tiene un paquete con ese nombre")
    except ErpManagedError:
        raise HTTPException(status_code=409, detail="Los paquetes de ese servicio los administra el ERP: cámbialos allí y sincroniza")
    if package is None:
        raise HTTPException(status_code=404, detail="Paquete no encontrado")
    return package
