from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.auth.public import User
from app.modules.leads.schemas import DashboardMetrics
from app.modules.auth.public import get_current_user
from app.modules.leads.dashboard.queries import SCOPE_MINE, SCOPE_TEAM, get_dashboard_metrics

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardMetrics)
async def dashboard(
    days: int = Query(default=30, ge=7, le=365),
    # Sin `scope` cada rol ve lo que le sirve de entrada: el vendedor sus leads
    # y sus flujos, el admin el total. Los rankings comparativos del equipo van
    # en el payload en los dos casos, así que un vendedor no necesita cambiar
    # de scope para saber cómo va respecto a los demás.
    scope: str | None = Query(default=None, pattern=f"^({SCOPE_MINE}|{SCOPE_TEAM})$"),
    # Las métricas de una persona del equipo, como si ella mirara "lo suyo":
    # el admin las usa para revisar o compartir el reporte de una vendedora.
    # Un vendedor solo puede pedir las propias; para comparar con los demás ya
    # tiene los rankings del equipo en el payload.
    seller_id: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
):
    if seller_id is not None and seller_id != user.id:
        if user.role != "admin":
            raise HTTPException(403, "Solo un administrador puede ver el dashboard de otra persona")
        return await get_dashboard_metrics(days, SCOPE_MINE, seller_id)
    if seller_id is not None:
        return await get_dashboard_metrics(days, SCOPE_MINE, user.id)
    # El analista no tiene leads propios: "lo mío" sería una pantalla vacía.
    default_scope = SCOPE_MINE if user.role == "vendedor" else SCOPE_TEAM
    return await get_dashboard_metrics(days, scope or default_scope, user.id)
