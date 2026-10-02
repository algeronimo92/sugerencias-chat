from fastapi import APIRouter, Depends, Query

from app.db.models.auth import User
from app.modules.auth.public import require_admin
from app.modules.leads.dashboard_service import get_dashboard_metrics

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(
    days: int = Query(default=30, ge=7, le=365),
    _admin: User = Depends(require_admin),
):
    return await get_dashboard_metrics(days)
