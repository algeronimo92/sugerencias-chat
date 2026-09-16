import logging

import httpx

from fastapi import Depends, HTTPException, Query
from db.models import LeadStage as DbLeadStage, User
from models.schemas import (
    Chat,
    ChatPage,
    KanbanPage,
    KanbanSnapshot,
    LeadCreate,
    LeadMergeRequest,
    LeadStage,
    LeadStageUpdate,
    LeadUpdate,
    LeadActivityItem,
    SellerItem,
)
from services.db_service import (
    CHATS_PAGE_SIZE,
    KANBAN_PAGE_SIZE,
    LeadAlreadyExistsError,
    create_lead,
    assign_tag,
    delete_lead,
    fetch_chat,
    fetch_chats,
    fetch_kanban_counts,
    fetch_kanban_snapshot,
    fetch_kanban_stage,
    list_lead_activity,
    fetch_total_unread_chat_count,
    mark_lead_no_show,
    list_active_sellers,
    rekey_lead_phone,
    remove_tag,
    update_lead,
    update_lead_stage,
)
from services.auth_service import get_current_user, require_admin
from services.lead_merge import LeadMergeError, merge_leads
from services.evolution_service import check_whatsapp_numbers
from services.whatsapp_channel import ChannelError
from services.phone_utils import (
    PhoneValidationError,
    digits_to_jid,
    effective_country_code,
    normalize_phone,
)
from services.ws_manager import manager
from services.lead_updates import lead_column_values
from services.automation_service import (
    pause_lead_executions,
    resume_lead_executions,
    trigger_lead_created,
    notify_automations_scheduled,
)
from routers.chats.common import chats_router


router = chats_router()
logger = logging.getLogger(__name__)


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
        parsed_stages = [DbLeadStage(value) for value in stages.split(",") if value] if stages else None
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


@router.get("/kanban/counts", response_model=dict[LeadStage, int])
async def get_kanban_counts(search: str | None = None):
    return await fetch_kanban_counts(search.strip() if search else None)


@router.get("/kanban/snapshot", response_model=KanbanSnapshot)
async def get_kanban_snapshot(search: str | None = None):
    return await fetch_kanban_snapshot(search.strip() if search else None)


@router.get("/kanban/{stage}", response_model=KanbanPage)
async def get_kanban_stage(
    stage: LeadStage,
    search: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=KANBAN_PAGE_SIZE, ge=1, le=100),
):
    return await fetch_kanban_stage(
        DbLeadStage(stage),
        search.strip() if search else None,
        offset,
        limit,
    )


@router.patch("/{chat_id}/stage", response_model=Chat)
async def move_chat_stage(chat_id: str, body: LeadStageUpdate, user: User = Depends(get_current_user)):
    lead = await update_lead_stage(
        chat_id, DbLeadStage(body.stage), "user", user.id, razon_perdido=body.razon_perdido
    )
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "stage_changed"})
    await notify_automations_scheduled(lead.get("automations_scheduled", 0))
    return lead


async def _verify_whatsapp_number(digits: str) -> tuple[bool | None, str | None]:
    """(existe, jid canónico). existe=None significa que no se pudo verificar
    (Evolution caída o sin configurar): se sigue adelante igual — bloquear el
    alta de leads porque WhatsApp está desconectado dejaría el CRM inusable."""
    try:
        rows = await check_whatsapp_numbers([digits])
    except (ChannelError, httpx.HTTPError):
        logger.warning("No se pudo verificar el número %s en WhatsApp; se continúa igual", digits, exc_info=True)
        return None, None
    row = rows[0] if rows and isinstance(rows[0], dict) else None
    if row is None:
        return None, None
    jid = row.get("jid")
    if not (isinstance(jid, str) and jid.endswith("@s.whatsapp.net")):
        jid = None
    return bool(row.get("exists")), jid


@router.post("", response_model=Chat, status_code=201)
async def create_chat(body: LeadCreate, user: User = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    try:
        digits = normalize_phone(body.phone, await effective_country_code())
    except PhoneValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if user.role != "admin" and body.vendedor_id not in (None, user.id):
        raise HTTPException(status_code=403, detail="Solo un administrador puede asignar otro vendedor")

    exists_wa, canonical_jid = await _verify_whatsapp_number(digits)
    if exists_wa is False:
        raise HTTPException(status_code=422, detail="Ese número no tiene WhatsApp. Revisalo e intentá de nuevo.")

    try:
        lead = await create_lead(
            phone=digits,
            name=name,
            servicio_interes=body.servicio_interes,
            vendedor_id=body.vendedor_id,
            origen=body.origen,
            notas=body.notas,
            secondary_phone=body.secondary_phone,
            actor_user_id=user.id,
            remote_jid=canonical_jid,
        )
    except LeadAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Ya existe un contacto con ese teléfono")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    await manager.broadcast({"type": "chats_updated", "chat_id": lead["chat_id"], "reason": "lead_created"})
    try:
        await trigger_lead_created(lead["chat_id"])
    except Exception:
        logger.exception("No se pudo programar la automatización de lead nuevo")
    return lead


@router.patch("/{chat_id}", response_model=Chat)
async def update_chat(chat_id: str, body: LeadUpdate, user: User = Depends(get_current_user)):
    if "vendedor_id" in body.model_fields_set and user.role != "admin" and body.vendedor_id != user.id:
        raise HTTPException(status_code=403, detail="Solo un administrador puede reasignar o quitar el vendedor")
    values = lead_column_values(body.model_dump(exclude_unset=True))

    # El teléfono ya no es la identidad del lead. Al cambiarlo solo se actualiza
    # su alias externo; el chat_id interno permanece estable.
    new_phone = values.pop("telefono", None)
    if new_phone:
        try:
            digits = normalize_phone(new_phone, await effective_country_code())
        except PhoneValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        new_jid = digits_to_jid(digits)
        exists_wa, canonical_jid = await _verify_whatsapp_number(digits)
        if exists_wa is False:
            raise HTTPException(status_code=422, detail="Ese número no tiene WhatsApp. Revisalo e intentá de nuevo.")
        try:
            rekeyed = await rekey_lead_phone(chat_id, digits, canonical_jid or new_jid, user.id)
        except LeadAlreadyExistsError:
            raise HTTPException(status_code=409, detail="Ya existe un contacto con ese teléfono")
        if rekeyed is None:
            raise HTTPException(status_code=404, detail="Lead no encontrado")

    try:
        lead = await update_lead(chat_id, values, "user", user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    # La pausa congela y la reanudación descongela: lo que quedó a medias sigue
    # después por donde iba, con el tiempo que le faltaba (ver
    # pause_lead_executions / resume_lead_executions).
    if values.get("automatizacion_pausada") is True:
        try:
            await pause_lead_executions(chat_id)
        except Exception:
            logger.exception("No se pudieron congelar las automatizaciones programadas al pausar %s", chat_id)
    elif values.get("automatizacion_pausada") is False:
        try:
            await resume_lead_executions(chat_id)
        except Exception:
            logger.exception("No se pudieron reanudar las automatizaciones congeladas de %s", chat_id)

    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"})
    return lead


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
    chat = await fetch_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return chat


@router.post("/{chat_id}/no-show", response_model=Chat)
async def register_no_show(chat_id: str, user: User = Depends(get_current_user)):
    """El vendedor confirma que el cliente no llegó a la cita agendada."""
    lead = await mark_lead_no_show(chat_id, user.id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"})
    return lead


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, _admin: User = Depends(require_admin)):
    """Borra el lead y todo su historial (mensajes, tareas, notas). No se
    puede deshacer: sin soft-delete, es admin-only a propósito."""
    if not await delete_lead(chat_id):
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_deleted"})


@router.post("/{chat_id}/merge", response_model=Chat)
async def merge_chat(chat_id: str, body: LeadMergeRequest, _admin: User = Depends(require_admin)):
    """Fusiona `other_id` (se borra) dentro de `chat_id` (se conserva)."""
    try:
        await merge_leads(body.other_id, chat_id, apply=True)
    except LeadMergeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    lead = await fetch_chat(chat_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "lead_updated"})
    await manager.broadcast({"type": "chats_updated", "chat_id": body.other_id, "reason": "lead_deleted"})
    return lead


@router.post("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def add_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    if not await assign_tag(chat_id, tag_id, user.id):
        raise HTTPException(status_code=404, detail="Lead o etiqueta no encontrados")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "tag_changed"})
    return await fetch_chat(chat_id)


@router.delete("/{chat_id}/tags/{tag_id}", response_model=Chat)
async def delete_chat_tag(chat_id: str, tag_id: int, user: User = Depends(get_current_user)):
    if not await remove_tag(chat_id, tag_id, user.id):
        raise HTTPException(status_code=404, detail="La etiqueta no está asignada")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "tag_changed"})
    return await fetch_chat(chat_id)


@router.get("/{chat_id}/activity", response_model=list[LeadActivityItem])
async def get_chat_activity(chat_id: str, limit: int = Query(default=50, ge=1, le=200)):
    return await list_lead_activity(chat_id, limit)
