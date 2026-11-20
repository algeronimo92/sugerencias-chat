"""Adaptador HTTP de las llamadas de WhatsApp (docs/analisis/17-plan-llamadas-whatsapp.md, §4.2).

Atender, ignorar y colgar exigen el permiso de llamadas; ver las llamadas de
un chat, solo estar autenticado (el analista queda fuera por su lista cerrada
de rutas).
"""

from fastapi import APIRouter, Depends, Query

import httpx

from app.core.errors import Forbidden
from app.integrations.whatsapp.channel import ChannelError
from app.integrations.whatsapp.connection import active_connection
from app.modules.auth.public import User, get_current_user
from app.modules.leads.ports.visibility import ensure_lead_visible, require_visible_lead, seller_scope, visible_lead_ids
from app.modules.conversations.application.calls import (
    answer_call,
    call_permission,
    request_call_permission,
    start_call,
    confirm_call_connected,
    dismiss_call,
    hang_up,
    public_call,
)
from app.modules.conversations.call_queries import call_answer, call_chat_id, call_offer, chat_calls, ringing_calls
from app.modules.conversations.domain.calls import CallNotAllowed
from app.modules.conversations.schemas import (
    CallAnswerRequest,
    CallAnswerState,
    CallHangUpRequest,
    CallItem,
    CallOffer,
    CallPermission,
    CallStartRequest,
)


async def require_call_agent(user: User = Depends(get_current_user)) -> User:
    if not user.can_handle_calls or user.role not in ("admin", "vendedor"):
        raise Forbidden("No tienes permiso para atender llamadas")
    return user


async def require_visible_call(call_id: int, user: User = Depends(require_call_agent)) -> None:
    if await seller_scope(user) is not None:
        await ensure_lead_visible(user, await call_chat_id(call_id))


router = APIRouter(prefix="/api/calls", tags=["calls"], dependencies=[Depends(get_current_user), Depends(require_visible_lead)])


@router.get("", response_model=list[CallItem])
async def list_chat_calls(chat_id: str = Query(min_length=1)):
    """Las llamadas de un chat, para intercalarlas en el hilo."""
    return await chat_calls(chat_id)


@router.get("/ringing", response_model=list[CallItem])
async def list_ringing_calls(user: User = Depends(require_call_agent)):
    """Las que suenan ahora. La pantalla la consulta cada pocos segundos: el
    aviso en vivo puede fallar sin que el navegador lo note."""
    calls = await ringing_calls(user.id)
    visible = await visible_lead_ids(user, [call["chat_id"] for call in calls])
    return [call for call in calls if call["chat_id"] in visible]


@router.get("/permission", response_model=CallPermission)
async def get_call_permission(chat_id: str = Query(min_length=1), _user: User = Depends(require_call_agent)):
    """Lo que Meta dice ahora sobre el permiso del cliente. Se pregunta cada
    vez: Meta no avisa cuando un permiso temporal vence."""
    try:
        return await call_permission(chat_id)
    except (ChannelError, httpx.HTTPError) as exc:
        raise CallNotAllowed(None) from exc


@router.post("/permission-request", status_code=202)
async def ask_call_permission(chat_id: str = Query(min_length=1), user: User = Depends(require_call_agent)):
    """Le pide al cliente permiso para llamarlo. Fuera de la ventana de 24 h
    se rechaza como cualquier mensaje libre: ahí hace falta una plantilla."""
    await request_call_permission(chat_id, user_id=user.id)
    return {"status": "queued"}


@router.post("", response_model=CallItem, status_code=201)
async def place_call(body: CallStartRequest, user: User = Depends(require_call_agent)):
    """Llama al cliente de ese chat. Meta la rechaza si no dio permiso."""
    await ensure_lead_visible(user, body.chat_id)
    row = await start_call(
        body.chat_id, user_id=user.id, client_id=body.client_id, sdp=body.sdp,
        phone_number_id=await active_connection(),
    )
    return public_call(row)


@router.get("/{call_id}/answer", response_model=CallAnswerState, dependencies=[Depends(require_visible_call)])
async def get_call_answer(call_id: int, user: User = Depends(require_call_agent)):
    return await call_answer(call_id, user.id)


@router.get("/{call_id}/offer", response_model=CallOffer, dependencies=[Depends(require_visible_call)])
async def get_call_offer(call_id: int, _user: User = Depends(require_call_agent)):
    return await call_offer(call_id)


@router.post("/{call_id}/accept", response_model=CallItem, dependencies=[Depends(require_visible_call)])
async def accept_call(call_id: int, body: CallAnswerRequest, user: User = Depends(require_call_agent)):
    row = await answer_call(
        call_id, user_id=user.id, client_id=body.client_id, sdp=body.sdp, pre_accept=body.pre_accept,
    )
    return public_call(row)


@router.post("/{call_id}/connected", response_model=CallItem, dependencies=[Depends(require_visible_call)])
async def call_connected(call_id: int, user: User = Depends(require_call_agent)):
    """El navegador confirma que hay audio, por si Meta no llegó a responder."""
    return public_call(await confirm_call_connected(call_id, user_id=user.id))


@router.post("/{call_id}/dismiss", response_model=CallItem, dependencies=[Depends(require_visible_call)])
async def ignore_call(call_id: int, user: User = Depends(require_call_agent)):
    """Deja de sonarle a esta persona. No le corta al cliente."""
    return public_call(await dismiss_call(call_id, user_id=user.id))


@router.post("/{call_id}/terminate", response_model=CallItem, dependencies=[Depends(require_visible_call)])
async def terminate_call(call_id: int, body: CallHangUpRequest, user: User = Depends(require_call_agent)):
    row = await hang_up(call_id, user_id=user.id, is_admin=user.role == "admin", cause=body.cause)
    return public_call(row)
