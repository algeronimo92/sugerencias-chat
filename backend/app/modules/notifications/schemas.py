"""Contratos HTTP de notifications."""

from pydantic import BaseModel
from domain_types import NotificationType


class NotificationItem(BaseModel):
    id: int
    notification_type: NotificationType
    title: str
    body: str
    lead_id: str | None = None
    source_id: str | None = None
    metadata: dict | None = None
    read_at: str | None = None
    created_at: str


class NotificationPage(BaseModel):
    items: list[NotificationItem]
    unread_count: int
    has_more: bool = False


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class VapidPublicKeyResponse(BaseModel):
    public_key: str
