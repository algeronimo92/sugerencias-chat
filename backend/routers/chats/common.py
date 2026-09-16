from fastapi import APIRouter, HTTPException
from services.db_service import lead_exists


ROUTER_PREFIX = "/api/chats"
ROUTER_TAGS = ["chats"]


def chats_router() -> APIRouter:
    return APIRouter(prefix=ROUTER_PREFIX, tags=ROUTER_TAGS)


async def _require_existing_lead(chat_id: str) -> None:
    if not await lead_exists(chat_id):
        raise HTTPException(404, "Lead no encontrado")
