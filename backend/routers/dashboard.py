from fastapi import APIRouter, Depends, Query

from db.models import User
from services.auth_service import require_admin
from services.dashboard_service import get_dashboard_metrics

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(
    days: int = Query(default=30, ge=7, le=365),
    _admin: User = Depends(require_admin),
):
    return await get_dashboard_metrics(days)
