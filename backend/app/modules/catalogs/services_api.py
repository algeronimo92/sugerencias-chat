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
)
from app.modules.catalogs.erp_catalog import ErpCatalogError, sync_catalog, sync_status, test_catalog
from app.modules.auth.public import get_current_user, require_admin
from app.modules.catalogs.queries import list_lead_services
from app.modules.catalogs.service import (
    ErpManagedError,
    LeadServiceAlreadyExistsError,
    ServiceInUseError,
    ServicePackageAlreadyExistsError,
    create_lead_service,
    create_service_package,
    delete_lead_service,
    update_lead_service,
    update_service_package,
)

router = APIRouter(prefix="/api/services", tags=["lead-services"])


@router.get("", response_model=list[LeadServiceItem])
async def get_services(_user: User = Depends(get_current_user)):
    return await list_lead_services()


@router.get("/all", response_model=list[LeadServiceItem])
async def get_all_services(_admin: User = Depends(require_admin)):
    return await list_lead_services(include_inactive=True)


# Antes de ``/{service_id}``: FastAPI prueba las rutas en orden y "erp-sync"
# no es un entero.
@router.get("/erp-sync", response_model=ErpSyncStatus)
async def get_erp_sync_status(_admin: User = Depends(require_admin)):
    return await sync_status()


@router.post("/erp-sync/test", response_model=ErpTestResult)
async def test_erp_connection(body: ErpTestRequest, _admin: User = Depends(require_admin)):
    """Pide el catálogo y lo valida sin guardar nada: para probar una URL
    antes de conectarla."""
    return await test_catalog(body.url)


@router.post("/erp-sync", response_model=ErpSyncStatus)
async def run_erp_sync(_admin: User = Depends(require_admin)):
    """Sincroniza ahora con el ERP. Si falla, el estado queda anotado igual."""
    try:
        return await sync_catalog()
    except ErpCatalogError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("", response_model=LeadServiceItem, status_code=201)
async def post_service(body: LeadServiceCreate, user: User = Depends(get_current_user)):
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
    admin: User = Depends(require_admin),
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


def _in_use_message(usages: list[str]) -> str:
    listed = usages[0] if len(usages) == 1 else f"{', '.join(usages[:-1])} y {usages[-1]}"
    return f"No se puede eliminar porque está en uso: {listed}. Desactívalo: deja de ofrecerse y el historial se conserva."


@router.delete("/{service_id}", status_code=204)
async def remove_service(service_id: int, _admin: User = Depends(require_admin)):
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
    _admin: User = Depends(require_admin),
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
    _admin: User = Depends(require_admin),
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
