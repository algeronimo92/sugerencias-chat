"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.modules.catalogs import repository
from app.modules.catalogs.repository import LeadServiceAlreadyExistsError
from app.modules.catalogs.repository import TagAlreadyExistsError

async def create_lead_service(name: str, user_id: int) -> dict:
    return await repository.create_lead_service(name, user_id)

async def create_tag(name: str, color: str, user_id: int) -> dict:
    return await repository.create_tag(name, color, user_id)

async def get_lead_service_by_name(name: str, active_only: bool=True) -> dict | None:
    return await repository.get_lead_service_by_name(name, active_only)

async def list_lead_services(include_inactive: bool=False) -> list[dict]:
    return await repository.list_lead_services(include_inactive)

async def list_tags(include_inactive: bool=False) -> list[dict]:
    return await repository.list_tags(include_inactive)

async def update_lead_service(service_id: int, values: dict, actor_user_id: int | None=None) -> dict | None:
    return await repository.update_lead_service(service_id, values, actor_user_id)

async def update_tag(tag_id: int, values: dict) -> dict | None:
    return await repository.update_tag(tag_id, values)
