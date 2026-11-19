"""Números de las llamadas de WhatsApp para el dashboard
(docs/analisis/17-plan-llamadas-whatsapp.md, fase 4).

Perdidas y fallidas nunca se suman: una perdida es de operación (faltó quien
atienda) y una fallida es técnica o de la cuenta. Mezclarlas no dice qué
arreglar.
"""

from __future__ import annotations

from datetime import datetime, tzinfo

from sqlalchemy import func, select

from app.db.models.conversations import WhatsAppCall
from app.db.uow import session_scope
from app.modules.auth.public import user_names
from app.modules.conversations.domain import calls as rules

PENDING_CALLBACKS_LIMIT = 20


def _by_cause(rows: list[tuple[str | None, int]]) -> list[dict]:
    items = []
    for key, count in rows:
        cause = rules.CAUSES.get(key or "") or rules.CAUSES["other"]
        items.append({"cause": cause.key, "label": cause.label, "group": cause.group, "action": cause.action, "count": count})
    return sorted(items, key=lambda item: -item["count"])


async def call_metrics(*, start: datetime, end: datetime, user_id: int | None, timezone: tzinfo) -> dict:
    """``user_id`` acota a las llamadas que manejó esa persona (el alcance
    "mis números" del dashboard); las perdidas no son de nadie y solo se ven
    en el alcance del equipo."""
    period = [WhatsAppCall.ringing_at >= start, WhatsAppCall.ringing_at < end]
    mine = [WhatsAppCall.handled_by_user_id == user_id] if user_id is not None else []
    inbound = WhatsAppCall.direction == rules.INBOUND
    async with session_scope() as session:
        by_status = dict((await session.execute(
            select(func.concat(WhatsAppCall.direction, ":", WhatsAppCall.status), func.count())
            .where(*period, *mine).group_by(WhatsAppCall.direction, WhatsAppCall.status)
        )).all())
        avg_duration = await session.scalar(
            select(func.avg(WhatsAppCall.duration_seconds)).where(*period, *mine, WhatsAppCall.status == rules.COMPLETED)
        )
        missed = (await session.execute(
            select(WhatsAppCall.cause, func.count()).where(*period, *mine, WhatsAppCall.status == rules.MISSED)
            .group_by(WhatsAppCall.cause)
        )).all()
        failed = (await session.execute(
            select(WhatsAppCall.cause, func.count())
            .where(*period, *mine, WhatsAppCall.status.in_((rules.FAILED, rules.REJECTED)))
            .group_by(WhatsAppCall.cause)
        )).all()
        failed_by_agent = (await session.execute(
            select(WhatsAppCall.handled_by_user_id, func.count())
            .where(*period, *mine, WhatsAppCall.status == rules.FAILED, WhatsAppCall.handled_by_user_id.is_not(None),
                   WhatsAppCall.cause.in_(("no_audio", "dropped", "microphone_blocked")))
            .group_by(WhatsAppCall.handled_by_user_id)
        )).all()
        hour = func.extract("hour", func.timezone(str(timezone), WhatsAppCall.ringing_at))
        by_hour_rows = (await session.execute(
            select(hour, WhatsAppCall.status, func.count())
            .where(*period, *mine, inbound, WhatsAppCall.status.in_((rules.COMPLETED, rules.MISSED)))
            .group_by(hour, WhatsAppCall.status)
        )).all()
        # Perdidas sin una llamada conectada después con ese cliente.
        later = WhatsAppCall.__table__.alias("later")
        pending = (await session.execute(
            select(WhatsAppCall.chat_id, func.max(WhatsAppCall.ringing_at))
            .where(*period, inbound, WhatsAppCall.status == rules.MISSED, WhatsAppCall.cause != "quick_hangup",
                   ~select(later.c.id).where(
                       later.c.chat_id == WhatsAppCall.chat_id, later.c.status == rules.COMPLETED,
                       later.c.ringing_at > WhatsAppCall.ringing_at,
                   ).exists())
            .group_by(WhatsAppCall.chat_id).order_by(func.max(WhatsAppCall.ringing_at).desc())
            .limit(PENDING_CALLBACKS_LIMIT)
        )).all() if user_id is None else []

    def count(direction: str, *statuses: str) -> int:
        return sum(by_status.get(f"{direction}:{status}", 0) for status in statuses)

    answered = count(rules.INBOUND, rules.COMPLETED, rules.ACCEPTED)
    missed_by_cause = _by_cause([tuple(row) for row in missed])
    quick = next((item["count"] for item in missed_by_cause if item["cause"] == "quick_hangup"), 0)
    missed_total = sum(item["count"] for item in missed_by_cause) - quick
    # Los que colgaron enseguida no cuentan contra el equipo: nadie llegaba a atender.
    offered = answered + missed_total
    names = await user_names(agent for agent, _count in failed_by_agent)
    hours: dict[int, dict] = {}
    for hour_value, status, total in by_hour_rows:
        slot = hours.setdefault(int(hour_value), {"hour": int(hour_value), "answered": 0, "missed": 0})
        slot["answered" if status == rules.COMPLETED else "missed"] += total
    return {
        "total": sum(by_status.values()),
        "inbound_answered": answered,
        "inbound_missed": missed_total,
        "quick_hangups": quick,
        "answer_rate": round(answered / offered, 3) if offered else None,
        "outbound_total": sum(total for key, total in by_status.items() if key.startswith(f"{rules.OUTBOUND}:")),
        "outbound_answered": count(rules.OUTBOUND, rules.COMPLETED, rules.ACCEPTED),
        "avg_duration_seconds": round(float(avg_duration)) if avg_duration is not None else None,
        "missed_by_cause": [item for item in missed_by_cause if item["cause"] != "quick_hangup"],
        "failed_total": sum(total for _cause, total in failed),
        "failed_by_cause": _by_cause([tuple(row) for row in failed]),
        "failed_by_agent": sorted(
            ({"user_id": agent, "name": names.get(agent) or "Sin nombre", "count": total} for agent, total in failed_by_agent),
            key=lambda item: -item["count"],
        ),
        "by_hour": [hours[key] for key in sorted(hours)],
        "pending_callbacks": [{"chat_id": chat_id, "ringing_at": at} for chat_id, at in pending],
    }
