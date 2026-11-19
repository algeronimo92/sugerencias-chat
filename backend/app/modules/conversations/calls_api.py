"""Adaptador HTTP de las llamadas de WhatsApp (docs/analisis/17-plan-llamadas-whatsapp.md, §4.2).

Atender, ignorar y colgar exigen el permiso de llamadas; ver las llamadas de
un chat, solo estar autenticado (el analista queda fuera por su lista cerrada
de rutas).
"""

from fastapi import APIRouter, Depends, Query

from app.core.errors import Forbidden
from app.modules.auth.public import User, get_current_user
from app.modules.conversations.application.calls import (
    answer_call,
    confirm_call_connected,
    dismiss_call,
    hang_up,
    public_call,
)
from app.modules.conversations.call_queries import call_offer, chat_calls, ringing_calls
from app.modules.conversations.schemas import CallAnswerRequest, CallHangUpRequest, CallItem, CallOffer


async def require_call_agent(user: User = Depends(get_current_user)) -> User:
    if not user.can_handle_calls or user.role not in ("admin", "vendedor"):
        raise Forbidden("No tienes permiso para atender llamadas")
    return user


router = APIRouter(prefix="/api/calls", tags=["calls"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[CallItem])
async def list_chat_calls(chat_id: str = Query(min_length=1)):
    """Las llamadas de un chat, para intercalarlas en el hilo."""
    return await chat_calls(chat_id)


@router.get("/ringing", response_model=list[CallItem])
async def list_ringing_calls(user: User = Depends(require_call_agent)):
    """Las que suenan ahora. La pantalla la consulta cada pocos segundos: el
    aviso en vivo puede fallar sin que el navegador lo note."""
    return await ringing_calls(user.id)


@router.get("/{call_id}/offer", response_model=CallOffer)
async def get_call_offer(call_id: int, _user: User = Depends(require_call_agent)):
    return await call_offer(call_id)


@router.post("/{call_id}/accept", response_model=CallItem)
async def accept_call(call_id: int, body: CallAnswerRequest, user: User = Depends(require_call_agent)):
    row = await answer_call(
        call_id, user_id=user.id, client_id=body.client_id, sdp=body.sdp, pre_accept=body.pre_accept,
    )
    return public_call(row)


@router.post("/{call_id}/connected", response_model=CallItem)
async def call_connected(call_id: int, user: User = Depends(require_call_agent)):
    """El navegador confirma que hay audio, por si Meta no llegó a responder."""
    return public_call(await confirm_call_connected(call_id, user_id=user.id))


@router.post("/{call_id}/dismiss", response_model=CallItem)
async def ignore_call(call_id: int, user: User = Depends(require_call_agent)):
    """Deja de sonarle a esta persona. No le corta al cliente."""
    return public_call(await dismiss_call(call_id, user_id=user.id))


@router.post("/{call_id}/terminate", response_model=CallItem)
async def terminate_call(call_id: int, body: CallHangUpRequest, user: User = Depends(require_call_agent)):
    row = await hang_up(call_id, user_id=user.id, is_admin=user.role == "admin", cause=body.cause)
    return public_call(row)
