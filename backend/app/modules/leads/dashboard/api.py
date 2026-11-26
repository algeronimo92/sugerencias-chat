from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.modules.auth.public import User
from app.modules.leads.schemas import DashboardMetrics
from app.modules.auth.public import Permission, can, require_permission
from app.modules.leads.dashboard.export import ANALYST_REPORTS, XLSX_MEDIA_TYPE, ExportReport, build_export
from app.modules.leads.dashboard.queries import SCOPE_MINE, SCOPE_TEAM, get_dashboard_metrics
from app.modules.platform.ports.plan import Feature, ensure_feature

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardMetrics)
async def dashboard(
    days: int = Query(default=30, ge=7, le=365),
    scope: str | None = Query(default=None, pattern=f"^({SCOPE_MINE}|{SCOPE_TEAM})$"),
    # Las métricas de una persona del equipo, como si ella mirara "lo suyo":
    # el admin las usa para revisar o compartir el reporte de una vendedora.
    seller_id: int | None = Query(default=None, ge=1),
    # El panel compara al equipo por nombre (rankings, mapas de horas en una
    # escala común). La dueña decidió el 2026-11-11 que por ahora lo lean solo
    # quienes dirigen: el vendedor no recibe ``dashboard.view`` por defecto.
    user: User = Depends(require_permission(Permission.DASHBOARD_VIEW)),
):
    if seller_id is not None and seller_id != user.id:
        if not can(user, Permission.DASHBOARD_VIEW_MEMBER):
            raise HTTPException(403, "Tu rol no puede ver el dashboard de otra persona")
        return await get_dashboard_metrics(days, SCOPE_MINE, seller_id)
    if seller_id is not None:
        return await get_dashboard_metrics(days, SCOPE_MINE, user.id)
    return await get_dashboard_metrics(days, scope or SCOPE_TEAM, user.id)


@router.get(
    "/export/{report}",
    response_class=Response,
    responses={200: {"content": {XLSX_MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}}, "description": "Archivo de Excel"}},
)
async def export_report(
    report: ExportReport,
    days: int = Query(default=30, ge=7, le=365),
    # El riesgo real es que una vendedora se vaya con la cartera de pacientes:
    # por defecto el vendedor no exporta nada, y el analista solo los números,
    # sin teléfonos ni DNI.
    user: User = Depends(require_permission(Permission.DASHBOARD_EXPORT, Permission.DASHBOARD_EXPORT_PERSONAL_DATA)),
):
    personal_data = can(user, Permission.DASHBOARD_EXPORT_PERSONAL_DATA)
    if not personal_data and report not in ANALYST_REPORTS:
        raise HTTPException(403, "Este reporte trae datos de pacientes: tu rol no puede exportarlo")
    # El respaldo completo va en todos los paquetes: los datos son del negocio.
    if report != ExportReport.BACKUP:
        await ensure_feature(Feature.REPORTS_EXPORT)
    exported = await build_export(report, days, user.id, personal_data=personal_data)
    return Response(
        content=exported.content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{exported.filename}"'},
    )
