"""Router compartido y helpers de los webhooks."""

from fastapi import APIRouter


ROUTER_PREFIX = "/api/webhooks"
ROUTER_TAGS = ["webhooks"]


def webhooks_router() -> APIRouter:
    return APIRouter(prefix=ROUTER_PREFIX, tags=ROUTER_TAGS)
