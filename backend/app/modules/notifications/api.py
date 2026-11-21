from fastapi import APIRouter, Depends, HTTPException, Query

from app.modules.auth.public import User
from app.modules.notifications.schemas import NotificationPage
from app.modules.auth.ports.auth_service import (Permission, get_current_user, require_permission)
from app.modules.notifications.queries import list_notifications
from app.modules.leads.ports.visibility import seller_scope
from app.modules.notifications.service import mark_all_notifications_read, mark_notification_read

# Los avisos hablan de leads: los recibe quien puede verlos.
router = APIRouter(prefix="/api/notifications", tags=["notifications"], dependencies=[Depends(require_permission(Permission.LEADS_VIEW))])


@router.get("", response_model=NotificationPage)
async def get_notifications(
    unread_only: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
):
    return await list_notifications(user.id, unread_only, limit, offset, owner_id=await seller_scope(user))


@router.post("/{notification_id}/read")
async def post_notification_read(notification_id: int, user: User = Depends(get_current_user)):
    if not await mark_notification_read(notification_id, user.id):
        raise HTTPException(404, "Notificación no encontrada")
    return {"status": "ok"}


@router.post("/read-all")
async def post_notifications_read_all(user: User = Depends(get_current_user)):
    count = await mark_all_notifications_read(user.id)
    return {"status": "ok", "updated": count}
