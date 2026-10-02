"""Lead use cases coordinating owner persistence and foreign operation contracts."""
from __future__ import annotations
from app.db.store_common import CHATS_PAGE_SIZE, KANBAN_PAGE_SIZE

from app.modules.catalogs.ports import repository as _catalogs_ports_repository

async def assign_tag(chat_id: str, tag_id: int, user_id: int | None) -> bool:
    return await _catalogs_ports_repository.assign_tag(chat_id, tag_id, user_id)


async def remove_tag(chat_id: str, tag_id: int, user_id: int | None) -> bool:
    return await _catalogs_ports_repository.remove_tag(chat_id, tag_id, user_id)

from app.modules.leads import kanban_repository as _leads_kanban_repository

async def fetch_kanban_counts(search: str | None=None) -> dict[str, int]:
    return await _leads_kanban_repository.fetch_kanban_counts(search)


async def fetch_kanban_snapshot(search: str | None=None, limit: int=KANBAN_PAGE_SIZE) -> dict:
    return await _leads_kanban_repository.fetch_kanban_snapshot(search, limit)


async def fetch_kanban_stage(stage: str, search: str | None=None, offset: int=0, limit: int=KANBAN_PAGE_SIZE) -> dict:
    return await _leads_kanban_repository.fetch_kanban_stage(stage, search, offset, limit)

from app.modules.leads import repository as _leads_repository

async def create_lead(phone: str, name: str, servicio_interes: str | None=None, vendedor_id: int | None=None, origen: str | None=None, notas: str | None=None, secondary_phone: str | None=None, custom_fields: dict | None=None, actor_user_id: int | None=None) -> dict:
    return await _leads_repository.create_lead(phone, name, servicio_interes, vendedor_id, origen, notas, secondary_phone, custom_fields, actor_user_id)


async def delete_lead(chat_id: str) -> bool:
    return await _leads_repository.delete_lead(chat_id)


async def list_lead_activity(chat_id: str, limit: int=50) -> list[dict]:
    return await _leads_repository.list_lead_activity(chat_id, limit)


async def mark_lead_no_show(chat_id: str, actor_user_id: int) -> dict | None:
    return await _leads_repository.mark_lead_no_show(chat_id, actor_user_id)


async def rekey_lead_phone(lead_id: str, new_digits: str, actor_user_id: int | None=None) -> dict | None:
    return await _leads_repository.rekey_lead_phone(lead_id, new_digits, actor_user_id)


async def update_lead(chat_id: str, values: dict, actor_type: str='system', actor_user_id: int | None=None) -> dict | None:
    return await _leads_repository.update_lead(chat_id, values, actor_type, actor_user_id)


async def update_lead_stage(chat_id: str, stage: str, actor_type: str='system', actor_user_id: int | None=None, metadata: dict | None=None, include_chat: bool=True, razon_perdido: str | None=None, schedule_automations: bool=True) -> dict | None:
    return await _leads_repository.update_lead_stage(chat_id, stage, actor_type, actor_user_id, metadata, include_chat, razon_perdido, schedule_automations)

from app.modules.conversations.ports import chat_queries as _conversations_ports_chat_queries

async def fetch_chat(chat_id: str) -> dict | None:
    return await _conversations_ports_chat_queries.fetch_chat(chat_id)


async def fetch_chats(search: str | None=None, cursor_ts: str | None=None, cursor_id: str | None=None, limit: int=CHATS_PAGE_SIZE, unread_only: bool=False, stages: list[str] | None=None, tag_ids: list[int] | None=None, tag_mode: str='any', service: str | None=None, seller_id: int | None=None, origin: str | None=None, last_sender: str | None=None, inactive_days: int | None=None, waiting_time: str | None=None, cursor_rank: int | None=None, automation_paused: bool=False) -> dict:
    return await _conversations_ports_chat_queries.fetch_chats(search, cursor_ts, cursor_id, limit, unread_only, stages, tag_ids, tag_mode, service, seller_id, origin, last_sender, inactive_days, waiting_time, cursor_rank, automation_paused)

from app.db import store_common as _store_common
from app.db.store_common import CHATS_PAGE_SIZE
from app.db.store_common import KANBAN_PAGE_SIZE
from app.db.store_common import LeadAlreadyExistsError
from app.modules.conversations.ports import read_state as _conversations_ports_read_state

async def fetch_total_unread_chat_count() -> int:
    return await _conversations_ports_read_state.fetch_total_unread_chat_count()

from app.modules.auth import public as _auth_public

async def list_active_sellers() -> list[dict]:
    return await _auth_public.list_active_sellers()
