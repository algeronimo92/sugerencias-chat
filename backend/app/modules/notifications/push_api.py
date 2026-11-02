from fastapi import APIRouter, Depends, Request

from app.core.config import settings
from app.modules.auth.public import User
from app.modules.notifications.schemas import PushSubscribeRequest, PushUnsubscribeRequest, VapidPublicKeyResponse
from app.modules.auth.ports.auth_service import (get_current_user)
from app.modules.notifications.push_service import delete_subscription, save_subscription

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public-key", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key(user: User = Depends(get_current_user)):
    return {"public_key": settings.vapid_public_key}


@router.post("/subscribe")
async def post_subscribe(
    body: PushSubscribeRequest,
    request: Request,
    user: User = Depends(get_current_user),
):
    await save_subscription(
        user.id,
        body.endpoint,
        body.keys.p256dh,
        body.keys.auth,
        request.headers.get("user-agent"),
    )
    return {"status": "ok"}


@router.post("/unsubscribe")
async def post_unsubscribe(body: PushUnsubscribeRequest, user: User = Depends(get_current_user)):
    await delete_subscription(user.id, body.endpoint)
    return {"status": "ok"}
