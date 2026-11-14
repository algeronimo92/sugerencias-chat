from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.modules.auth.public import User
from app.modules.leads.schemas import DashboardMetrics
from app.modules.auth.public import get_current_user
from app.modules.leads.dashboard.export import ANALYST_REPORTS, XLSX_MEDIA_TYPE, ExportReport, build_export
from app.modules.leads.dashboard.queries import SCOPE_MINE, SCOPE_TEAM, get_dashboard_metrics

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardMetrics)
async def dashboard(
    days: int = Query(default=30, ge=7, le=365),
    scope: str | None = Query(default=None, pattern=f"^({SCOPE_MINE}|{SCOPE_TEAM})$"),
    # Las métricas de una persona del equipo, como si ella mirara "lo suyo":
    # el admin las usa para revisar o compartir el reporte de una vendedora.
    seller_id: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
):
    # El panel compara al equipo por nombre (rankings, mapas de horas en una
    # escala común). La dueña decidió el 2026-11-11 que por ahora lo lean solo
    # quienes dirigen; antes un vendedor veía lo suyo y los rankings del equipo.
    # Se niega acá y no solo en el menú: la ruta se puede pedir a mano.
    if user.role == "vendedor":
        raise HTTPException(403, "El dashboard está disponible solo para administradores y analistas")
    if seller_id is not None and seller_id != user.id:
        if user.role != "admin":
            raise HTTPException(403, "Solo un administrador puede ver el dashboard de otra persona")
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
    user: User = Depends(get_current_user),
):
    # El riesgo real es que una vendedora se vaya con la cartera de pacientes:
    # el vendedor no exporta nada, y el analista solo los números, sin
    # teléfonos ni DNI.
    if user.role == "vendedor":
        raise HTTPException(403, "Exportar está disponible solo para administradores y analistas")
    if user.role != "admin" and report not in ANALYST_REPORTS:
        raise HTTPException(403, "Este reporte trae datos de pacientes: solo un administrador puede exportarlo")
    exported = await build_export(report, days, user.id, personal_data=user.role == "admin")
    return Response(
        content=exported.content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{exported.filename}"'},
    )
