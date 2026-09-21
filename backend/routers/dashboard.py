from fastapi import APIRouter, Depends, Query

from db.models import User
from services.auth_service import get_current_user
from services.dashboard import SCOPE_MINE, SCOPE_TEAM, get_dashboard_metrics

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(
    days: int = Query(default=30, ge=7, le=365),
    # Sin `scope` cada rol ve lo que le sirve de entrada: el vendedor sus leads
    # y sus flujos, el admin el total. Los rankings comparativos del equipo van
    # en el payload en los dos casos, así que un vendedor no necesita cambiar
    # de scope para saber cómo va respecto a los demás.
    scope: str | None = Query(default=None, pattern=f"^({SCOPE_MINE}|{SCOPE_TEAM})$"),
    user: User = Depends(get_current_user),
):
    default_scope = SCOPE_TEAM if user.role == "admin" else SCOPE_MINE
    return await get_dashboard_metrics(days, scope or default_scope, user.id)
