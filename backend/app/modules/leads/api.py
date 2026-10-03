"""Adaptador HTTP de leads.

Valida la entrada, llama a un comando o a una consulta y devuelve la tarjeta
del chat. No traduce errores (lo hace el handler de ``DomainError``) ni avisa
por WebSocket (lo hacen los suscriptores de los eventos del lead).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.phone_utils import PhoneValidationError, normalize_phone
from app.db.models.auth import User
from app.db.store_common import CHATS_PAGE_SIZE, KANBAN_PAGE_SIZE
from app.modules.auth.public import get_current_user, list_active_sellers, require_admin
from app.modules.catalogs.ports.custom_fields import CustomFieldError, normalize_values
from app.modules.conversations.ports.chat_queries import fetch_chat, fetch_chats
from app.modules.conversations.ports.read_state import fetch_total_unread_chat_count
from app.modules.leads.application import commands
from app.modules.leads.domain.lead import Actor
from app.modules.leads.kanban_queries import fetch_kanban_counts, fetch_kanban_snapshot, fetch_kanban_stage
from app.modules.leads.queries import list_lead_activity
from app.modules.leads.schemas import (
    Chat,
    ChatPage,
    KanbanPage,
    KanbanSnapshot,
    LeadActivityItem,
    LeadCreate,
    LeadMergeRequest,
    LeadStageKey,
    LeadStageUpdate,
    LeadUpdate,
    SellerItem,
)
from app.modules.leads.updates import lead_column_values
from app.modules.platform.public import effective_country_code


router = APIRouter(prefix="/api/chats", tags=["chats"])
logger = logging.getLogger(__name__)


async def _chat_or_404(chat_id: str) -> dict:
    chat = await fetch_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return chat


async def _normalized_phone(raw: str) -> str:
    try:
        return normalize_phone(raw, await effective_country_code())
    except PhoneValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=ChatPage)
async def get_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
    unread_only: bool = False,
    stages: str | None = None,
    tag_ids: str | None = None,
    tag_mode: str = Query(default="any", pattern="^(any|all)$"),
    service: str | None = None,
    seller_id: int | None = Query(default=None, ge=1),
    origin: str | None = None,
    last_sender: str | None = Query(default=None, pattern="^(cliente|vendedor)$"),
    inactive_days: int | None = Query(default=None, ge=1, le=3650),
    waiting_time: str | None = Query(default=None, pattern="^(any|fresh|warning|urgent)$"),
    cursor_rank: int | None = Query(default=None, ge=0, le=2),
    automation_paused: bool = False,
):
    try:
        # Una clave inexistente no es un error: simplemente no filtra nada
        # (puede venir de un filtro guardado antes de borrar la etapa).
        parsed_stages = [value for value in stages.split(",") if value] if stages else None
        parsed_tag_ids = [int(value) for value in tag_ids.split(",") if value] if tag_ids else None
        return await fetch_chats(
            search.strip() if search else None,
            cursor_ts,
            cursor_id,
            limit,
            unread_only,
            parsed_stages,
            parsed_tag_ids,
            tag_mode,
            service,
            seller_id,
            origin,
            last_sender,
            inactive_days,
            waiting_time,
            cursor_rank,
            automation_paused,
        )
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Filtros inválidos")
    except Exception:
        logger.exception("Error inesperado al listar chats")
        raise HTTPException(status_code=500, detail="Error interno al listar chats")


@router.get("/unread-count")
async def get_unread_count():
    """Cantidad de chats no leídos; solo baja al marcar uno como visto."""
    return {"count": await fetch_total_unread_chat_count()}


@router.get("/kanban/counts", response_model=dict[str, int])
async def get_kanban_counts(search: str | None = None):
    return await fetch_kanban_counts(search.strip() if search else None)


@router.get("/kanban/snapshot", response_model=KanbanSnapshot)
async def get_kanban_snapshot(search: str | None = None):
    return await fetch_kanban_snapshot(search.strip() if search else None)


@router.get("/kanban/{stage}", response_model=KanbanPage)
async def get_kanban_stage(
    stage: LeadStageKey,
    search: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=KANBAN_PAGE_SIZE, ge=1, le=100),
):
    return await fetch_kanban_stage(stage, search.strip() if search else None, offset, limit)


@router.patch("/{chat_id}/stage", response_model=Chat)
async def move_chat_stage(chat_id: str, body: LeadStageUpdate, user: User = Depends(get_current_user)):
    await commands.change_stage(
        chat_id, body.stage, actor=Actor.user(user.id), lost_reason=body.razon_perdido,
    )
    return await _chat_or_404(chat_id)


@router.post("", response_model=Chat, status_code=201)
async def create_chat(body: LeadCreate, user: User = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    digits = await _normalized_phone(body.phone)

    if user.role != "admin" and body.vendedor_id not in (None, user.id):
        raise HTTPException(status_code=403, detail="Solo un administrador puede asignar otro vendedor")

    try:
        custom_fields = await normalize_values("lead", body.custom_fields, require_required=True)
    except CustomFieldError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Meta no ofrece consultar si un número tiene WhatsApp: el wa_id tipeado
    # se usa tal cual y, si Meta lo normaliza al enviar, el outbox suma el
    # que informe como alias del lead.
    lead_id = await commands.create_lead(
        digits,
        name,
        actor=Actor.user(user.id),
        servicio_interes=body.servicio_interes,
        vendedor_id=body.vendedor_id,
        origen=body.origen,
        notas=body.notas,
        secondary_phone=body.secondary_phone,
        custom_fields=custom_fields,
    )
    return await _chat_or_404(lead_id)


@router.patch("/{chat_id}", response_model=Chat)
async def update_chat(chat_id: str, body: LeadUpdate, user: User = Depends(get_current_user)):
    if "vendedor_id" in body.model_fields_set and user.role != "admin" and body.vendedor_id != user.id:
        raise HTTPException(status_code=403, detail="Solo un administrador puede reasignar o quitar el vendedor")
    values = lead_column_values(body.model_dump(exclude_unset=True))

    # El teléfono ya no es la identidad del lead. Al cambiarlo solo se actualiza
    # su alias externo; el chat_id interno permanece estable.
    new_phone = values.pop("telefono", None)
    digits = await _normalized_phone(new_phone) if new_phone else None
    await commands.edit_lead(chat_id, values, actor=Actor.user(user.id), phone=digits)
    return await _chat_or_404(chat_id)


@router.get("/sellers", response_model=list[SellerItem])
async def get_sellers():
    return await list_active_sellers()


@router.get("/phone-config")
async def get_phone_config():
    """Código de país por defecto para el form de leads. Existe aparte de
    /api/settings porque aquel es admin-only y los vendedores también crean
    leads."""
    return {"default_country_code": await effective_country_code()}


@router.get("/{chat_id}", response_model=Chat)
async def get_chat(chat_id: str):
    return await _chat_or_404(chat_id)


@router.post("/{chat_id}/no-show", response_model=Chat)
async def register_no_show(chat_id: str, user: User = Depends(get_current_user)):
    """El vendedor confirma que el cliente no llegó a la cita agendada."""
    await commands.register_no_show(chat_id, actor=Actor.user(user.id))
    return await _chat_or_404(chat_id)


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, admin: User = Depends(require_admin)):
    """Borra el lead y todo su historial (mensajes, tareas, notas). No se
    puede deshacer: sin soft-delete, es admin-only a propósito."""
    await commands.delete_lead(chat_id, actor=Actor.user(admin.id))


@router.post("/{chat_id}/merge", response_model=Chat)
async def merge_chat(chat_id: str, body: LeadMergeRequest, admin: User = Depends(require_admin)):
    """Fusiona `other_id` (se borra) dentro de `chat_id` (se conserva)."""
    await commands.merge_leads(body.other_id, chat_id, actor=Actor.user(admin.id))
    return await _chat_or_404(chat_id)


@router.post("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def add_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    await commands.assign_tag(chat_id, tag_id, actor=Actor.user(user.id))
    return await _chat_or_404(chat_id)


@router.delete("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def delete_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    await commands.remove_tag(chat_id, tag_id, actor=Actor.user(user.id))
    return await _chat_or_404(chat_id)


@router.get("/{chat_id}/activity", response_model=list[LeadActivityItem])
async def get_chat_activity(chat_id: str, limit: int = Query(default=50, ge=1, le=200)):
    return await list_lead_activity(chat_id, limit)
