"""Router compartido y helpers de los webhooks."""

from datetime import datetime
from fastapi import APIRouter


ROUTER_PREFIX = "/api/webhooks"
ROUTER_TAGS = ["webhooks"]


def webhooks_router() -> APIRouter:
    return APIRouter(prefix=ROUTER_PREFIX, tags=ROUTER_TAGS)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    """asyncpg exige un datetime.datetime real para una columna timestamptz
    -a diferencia de uuid/texto, no acepta la representación en string y la
    parsea del lado del server."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
