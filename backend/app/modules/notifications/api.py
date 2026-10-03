from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.models.auth import User
from app.modules.notifications.schemas import NotificationPage
from app.modules.auth.ports.auth_service import (get_current_user)
from app.modules.notifications.service import (
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
)
from app.core.events import publish
from app.modules.notifications.events import NotificationsRead

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=NotificationPage)
async def get_notifications(
    unread_only: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
):
    return await list_notifications(user.id, unread_only, limit, offset)


@router.post("/{notification_id}/read")
async def post_notification_read(notification_id: int, user: User = Depends(get_current_user)):
    if not await mark_notification_read(notification_id, user.id):
        raise HTTPException(404, "Notificación no encontrada")
    await publish(NotificationsRead(user_id=user.id))
    return {"status": "ok"}


@router.post("/read-all")
async def post_notifications_read_all(user: User = Depends(get_current_user)):
    count = await mark_all_notifications_read(user.id)
    await publish(NotificationsRead(user_id=user.id))
    return {"status": "ok", "updated": count}
