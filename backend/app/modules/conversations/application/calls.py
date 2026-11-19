"""Casos de uso de las llamadas de WhatsApp (docs/analisis/17-plan-llamadas-whatsapp.md, §4.2).

Ninguna llamada al proveedor ocurre dentro de una transacción con la fila
bloqueada: se reclama en una transacción corta, se habla con Meta y se
confirma en otra. Así, si Meta tarda, no queda la base esperando.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.uow import collect, unit_of_work
from app.integrations.whatsapp.channel import CallOutcomeUnknown, ChannelError
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.domain import calls as rules
from app.modules.conversations.domain.events import (
    CallAnswered,
    CallClaimed,
    CallDismissed,
    CallEnded,
    CallReleased,
    CallRinging,
)

logger = logging.getLogger(__name__)

RINGING_GIVE_UP = timedelta(minutes=2)
ACCEPTED_GIVE_UP = timedelta(hours=4)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ports():
    ports = conversation_ports()
    if ports.calls is None:
        raise RuntimeError("No hay almacenamiento de llamadas configurado (ver app.composition)")
    return ports


def _control():
    control = conversation_ports().current_channel().calls
    if control is None:
        raise RuntimeError("El canal de WhatsApp no maneja llamadas")
    return control


def _ended(row: dict, caller_name: str | None = None) -> CallEnded:
    return CallEnded(
        chat_id=row["chat_id"], call_id=row["id"], status=row["status"], cause=row.get("cause"),
        handled_by_user_id=row.get("handled_by_user_id"), caller_name=caller_name,
    )


async def receive_call(
    *, chat_id: str, wa_call_id: str, phone_number_id: str, sdp: str | None,
    occurred_at: datetime | None, received_at: datetime | None, event: dict,
    caller_name: str | None = None,
) -> dict:
    """Meta avisa que un cliente está llamando (``connect`` con la oferta SDP).

    Un aviso repetido no la vuelve a hacer sonar. Uno que llegó tarde se
    registra como perdido, sin timbre: el cliente ya colgó.
    """
    ports = _ports()
    now = _now()
    async with unit_of_work():
        row, created = await ports.calls.insert_ringing(
            wa_call_id=wa_call_id, chat_id=chat_id, phone_number_id=phone_number_id,
            ringing_at=occurred_at or now, remote_sdp=sdp, event=event,
        )
        if not created:
            await ports.calls.append_event(row["id"], event)
            return row
        await ports.inbox.touch_last_message(chat_id, now)
        arrived = received_at or now
        if (now - arrived).total_seconds() > rules.STALE_CONNECT_SECONDS:
            finished = await ports.calls.finish(
                row["id"], status=rules.MISSED, cause="late_notice", error_code=None, ended_at=now,
                accepted_at=None, duration_seconds=None, closed_by=None,
            )
            if finished:
                collect(_ended(finished, caller_name))
                return finished
        collect(CallRinging(chat_id=chat_id, call_id=row["id"], caller_name=caller_name))
    return row


async def record_call_end(
    *, chat_id: str, wa_call_id: str, phone_number_id: str, duration_seconds: int | None,
    started_at: datetime | None, ended_at: datetime | None, error_code: str | None,
    occurred_at: datetime | None, event: dict, caller_name: str | None = None,
) -> dict | None:
    """Meta avisa que la llamada terminó (``terminate``). Puede llegar antes
    que el ``connect``: si la llamada no existe, se registra ya terminada."""
    ports = _ports()
    now = _now()
    async with unit_of_work():
        row = await ports.calls.get_by_wa_call_id(wa_call_id)
        if row is None:
            row, _ = await ports.calls.insert_ringing(
                wa_call_id=wa_call_id, chat_id=chat_id, phone_number_id=phone_number_id,
                ringing_at=occurred_at or now, remote_sdp=None, event=event,
            )
        else:
            await ports.calls.append_event(row["id"], event)
        if duration_seconds is not None or started_at is not None:
            status, cause = rules.COMPLETED, None
        elif error_code:
            status, cause = rules.FAILED, rules.cause_for_meta_code(error_code)
        else:
            agents = await ports.call_agents() if ports.call_agents else []
            ringing_for = ((ended_at or now) - row["ringing_at"]).total_seconds() if row.get("ringing_at") else None
            agent_ids = {agent["id"] for agent in agents}
            status = rules.MISSED
            cause = rules.missed_cause(
                ringing_for, agents_connected=bool(agent_ids),
                all_dismissed=bool(agent_ids) and agent_ids <= set(row.get("dismissed_by") or []),
            )
        finished = await ports.calls.finish(
            row["id"], status=status, cause=cause, error_code=str(error_code) if error_code else None,
            ended_at=ended_at or now, accepted_at=started_at, duration_seconds=duration_seconds,
            closed_by=None,
        )
        if finished:
            collect(_ended(finished, caller_name))
        if error_code and not rules.is_known_meta_code(error_code):
            logger.warning("Código de Meta de llamadas sin causa en el catálogo: %s", error_code)
    return finished


async def answer_call(call_id: int, *, user_id: int, client_id: str, sdp: str, pre_accept: bool = False) -> dict:
    """Quien pulsó Atender reclama la llamada y se la acepta a Meta.

    Si Meta no responde, la llamada no se libera: pudo haberla conectado, y
    soltarla dejaría que otra persona atienda una llamada ya en curso. Decide
    el navegador, que sabe si hay audio (``confirm_call_connected``), y si
    no, el reclamo vence y el ciclo de limpieza la cuelga.
    """
    rules.validate_sdp(sdp)
    ports = _ports()
    now = _now()
    async with unit_of_work():
        row = await ports.calls.get(call_id)
        if row is None:
            raise rules.CallNotFound()
        claimed = await ports.calls.claim(
            call_id, user_id=user_id, client_id=client_id, until=now + timedelta(seconds=rules.CLAIM_SECONDS),
        )
        if claimed is None:
            raise rules.CallNoLongerRinging()
        collect(CallClaimed(chat_id=claimed["chat_id"], call_id=call_id, user_id=user_id))
    try:
        await _control().accept(claimed["wa_call_id"], sdp, pre_accept=pre_accept)
    except CallOutcomeUnknown:
        logger.warning("Meta no confirmó el accept de la llamada %s", call_id)
        return claimed
    except ChannelError as exc:
        async with unit_of_work():
            released = await ports.calls.release(call_id, user_id=user_id)
            if released:
                collect(CallReleased(chat_id=released["chat_id"], call_id=call_id))
        raise rules.CallNoLongerRinging("Meta no dejó atender la llamada; puede que el cliente ya haya colgado") from exc
    return await confirm_call_connected(call_id, user_id=user_id)


async def confirm_call_connected(call_id: int, *, user_id: int) -> dict:
    ports = _ports()
    async with unit_of_work():
        accepted = await ports.calls.mark_accepted(call_id, user_id=user_id, at=_now())
        if accepted is None:
            row = await ports.calls.get(call_id)
            if row is None:
                raise rules.CallNotFound()
            if row.get("handled_by_user_id") != user_id:
                raise rules.CallNotYours()
            return row
        collect(CallAnswered(chat_id=accepted["chat_id"], call_id=call_id, user_id=user_id))
    return accepted


async def dismiss_call(call_id: int, *, user_id: int) -> dict:
    """Deja de sonarle a esa persona. Si ya la ignoraron todos los que
    atienden, se rechaza en Meta: así el cliente no espera en vano."""
    ports = _ports()
    async with unit_of_work():
        row = await ports.calls.dismiss(call_id, user_id)
        if row is None:
            existing = await ports.calls.get(call_id)
            if existing is None:
                raise rules.CallNotFound()
            return existing
        collect(CallDismissed(chat_id=row["chat_id"], call_id=call_id, user_id=user_id))
        agents = await ports.call_agents() if ports.call_agents else []
    agent_ids = {agent["id"] for agent in agents}
    if agent_ids and agent_ids <= set(row.get("dismissed_by") or []):
        try:
            await _control().reject(row["wa_call_id"])
        except (ChannelError, Exception):
            logger.warning("No se pudo rechazar en Meta la llamada %s que todos ignoraron", call_id, exc_info=True)
    return row


async def hang_up(call_id: int, *, user_id: int, is_admin: bool, cause: str | None = None) -> dict:
    """Cuelga quien atiende (o una admin). El cierre queda marcado como
    local: el ``terminate`` de Meta lo corrige después con la duración real."""
    ports = _ports()
    row = await ports.calls.get(call_id)
    if row is None:
        raise rules.CallNotFound()
    if row.get("handled_by_user_id") != user_id and not is_admin:
        raise rules.CallNotYours()
    if row["status"] in rules.FINAL_STATUSES:
        return row
    try:
        await _control().terminate(row["wa_call_id"])
    except Exception:
        logger.warning("No se pudo colgar en Meta la llamada %s", call_id, exc_info=True)
    browser_cause = cause if cause in rules.BROWSER_CAUSES else None
    async with unit_of_work():
        status = rules.COMPLETED if row["status"] == rules.ACCEPTED and browser_cause is None else rules.FAILED
        finished = await ports.calls.finish(
            call_id, status=status, cause=browser_cause, error_code=None, ended_at=_now(),
            accepted_at=row.get("accepted_at"), duration_seconds=None, closed_by="agent",
        )
        if finished:
            collect(_ended(finished))
    return finished or row


async def reap_calls() -> int:
    """Cierra lo que quedó colgado porque Meta nunca mandó el ``terminate``."""
    ports = _ports()
    now = _now()
    stale = await ports.calls.stale(
        ringing_before=now - RINGING_GIVE_UP, claim_expired_at=now, accepted_before=now - ACCEPTED_GIVE_UP,
    )
    closed = 0
    for row in stale:
        if row["status"] == rules.CONNECTING:
            # El reclamo venció sin que nadie confirmara el audio: se cuelga
            # en Meta para no dejar al cliente en una llamada muda.
            try:
                await _control().terminate(row["wa_call_id"])
            except Exception:
                logger.warning("No se pudo colgar la llamada %s sin confirmar", row["id"], exc_info=True)
            status, cause = rules.FAILED, "unconfirmed"
        elif row["status"] == rules.ACCEPTED:
            status, cause = rules.COMPLETED, None
        else:
            status, cause = rules.MISSED, "closed_without_meta"
        async with unit_of_work():
            finished = await ports.calls.finish(
                row["id"], status=status, cause=cause, error_code=None, ended_at=now,
                accepted_at=row.get("accepted_at"), duration_seconds=None, closed_by=rules.REAPER,
            )
            if finished:
                collect(_ended(finished))
                closed += 1
    return closed


def public_call(row: dict[str, Any]) -> dict[str, Any]:
    """La llamada como la ve la pantalla: sin la oferta SDP ni los eventos crudos."""
    cause = rules.CAUSES.get(row.get("cause") or "")
    return {
        "id": row["id"],
        "chat_id": row["chat_id"],
        "direction": row["direction"],
        "status": row["status"],
        "cause": row.get("cause"),
        "cause_label": cause.label if cause else None,
        "cause_group": cause.group if cause else None,
        "error_code": row.get("error_code"),
        "ringing_at": row["ringing_at"],
        "accepted_at": row.get("accepted_at"),
        "ended_at": row.get("ended_at"),
        "duration_seconds": row.get("duration_seconds"),
        "handled_by_user_id": row.get("handled_by_user_id"),
    }
