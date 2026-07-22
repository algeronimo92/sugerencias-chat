import asyncio
from datetime import date, datetime, time, timedelta, timezone
from time import monotonic

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from domain_types import TaskStatus
from db.models import Lead, LeadStage, LeadTask, User, WspMessage
from db.session import get_sessionmaker


_CACHE_TTL_SECONDS = 30.0
_cache: dict[int, tuple[float, dict]] = {}
_cache_lock = asyncio.Lock()


def _series(rows, start_date: date, days: int) -> list[dict]:
    values = {row["day"]: int(row["total"]) for row in rows}
    return [
        {"date": (start_date + timedelta(days=offset)).isoformat(), "value": values.get(start_date + timedelta(days=offset), 0)}
        for offset in range(days)
    ]


async def _execute_mapping(stmt):
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).mappings().all()


async def _compute_dashboard_metrics(days: int) -> dict:
    now = datetime.now(timezone.utc)
    # Perú mantiene UTC-5 durante todo el año; usar offset fijo evita depender
    # del paquete tzdata en instalaciones Windows de Python.
    business_timezone = timezone(timedelta(hours=-5))
    local_today = now.astimezone(business_timezone).date()
    start_date = local_today - timedelta(days=days - 1)
    start = datetime.combine(start_date, time.min, tzinfo=business_timezone).astimezone(timezone.utc)
    latest_sender = (
        select(WspMessage.sender)
        .where(WspMessage.chat_id == Lead.remote_jid)
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
        .limit(1)
        .correlate(Lead)
        .scalar_subquery()
    )

    customer_message = aliased(WspMessage)
    seller_message = aliased(WspMessage)
    next_seller_response = (
        select(func.min(seller_message.sent_at))
        .where(
            seller_message.chat_id == customer_message.chat_id,
            seller_message.sender == "vendedor",
            seller_message.sent_at > customer_message.sent_at,
        )
        .correlate(customer_message)
        .scalar_subquery()
    )

    summary_stmt = select(
        select(func.count(Lead.remote_jid)).scalar_subquery().label("total_leads"),
        select(func.count(Lead.remote_jid)).where(Lead.created_at >= start).scalar_subquery().label("new_leads"),
        select(func.count(Lead.remote_jid)).where(latest_sender == "cliente").scalar_subquery().label("awaiting_reply"),
        select(func.count(LeadTask.id)).where(
                LeadTask.status == TaskStatus.PENDING,
                LeadTask.due_at < now,
            ).scalar_subquery().label("overdue_tasks"),
        select(func.count(LeadTask.id)).where(
                LeadTask.status == TaskStatus.COMPLETED,
                LeadTask.completed_at >= start,
            ).scalar_subquery().label("completed_tasks"),
        select(func.avg(func.extract("epoch", next_seller_response - customer_message.sent_at))).where(
                customer_message.sender == "cliente",
                customer_message.sent_at >= start,
                next_seller_response.is_not(None),
            ).scalar_subquery().label("avg_response_seconds"),
    )
    stage_stmt = (
        select(Lead.estado.label("name"), func.count(Lead.remote_jid).label("value"))
            .group_by(Lead.estado)
            .order_by(func.count(Lead.remote_jid).desc())
    )
    origin_label = func.coalesce(Lead.origen, "Sin origen")
    origin_stmt = (
        select(origin_label.label("name"), func.count(Lead.remote_jid).label("value"))
            .group_by(origin_label)
            .order_by(func.count(Lead.remote_jid).desc()).limit(8)
    )
    service_label = func.coalesce(Lead.servicio_interes, "Sin servicio")
    service_stmt = (
        select(service_label.label("name"), func.count(Lead.remote_jid).label("value"))
            .group_by(service_label)
            .order_by(func.count(Lead.remote_jid).desc()).limit(8)
    )
    seller_label = func.coalesce(User.name, Lead.vendedor, "Sin asignar")
    seller_stmt = (
        select(seller_label.label("name"), func.count(Lead.remote_jid).label("value"))
            .outerjoin(User, User.id == Lead.vendedor_id)
            .group_by(seller_label)
            .order_by(func.count(Lead.remote_jid).desc()).limit(12)
    )
    local_created_day = func.date(func.timezone("America/Lima", Lead.created_at))
    trend_stmt = (
        select(local_created_day.label("day"), func.count(Lead.remote_jid).label("total"))
            .where(Lead.created_at >= start)
            .group_by(local_created_day)
            .order_by(local_created_day)
    )

    summary_rows, stage_rows, origin_rows, service_rows, seller_rows, trend_rows = await asyncio.gather(
        _execute_mapping(summary_stmt),
        _execute_mapping(stage_stmt),
        _execute_mapping(origin_stmt),
        _execute_mapping(service_stmt),
        _execute_mapping(seller_stmt),
        _execute_mapping(trend_stmt),
    )
    summary = summary_rows[0]
    avg_response_seconds = summary["avg_response_seconds"]

    stages = {stage.value: 0 for stage in LeadStage}
    for row in stage_rows:
        key = row["name"].value if isinstance(row["name"], LeadStage) else str(row["name"])
        stages[key] = int(row["value"])

    def items(rows):
        return [{"name": str(row["name"]), "value": int(row["value"])} for row in rows]

    return {
        "period_days": days,
        "summary": {
            "total_leads": int(summary["total_leads"] or 0),
            "new_leads": int(summary["new_leads"] or 0),
            "awaiting_reply": int(summary["awaiting_reply"] or 0),
            "overdue_tasks": int(summary["overdue_tasks"] or 0),
            "completed_tasks": int(summary["completed_tasks"] or 0),
            "avg_response_minutes": round(float(avg_response_seconds) / 60, 1) if avg_response_seconds is not None else None,
        },
        "stages": [{"name": stage.value, "value": stages[stage.value]} for stage in LeadStage],
        "origins": items(origin_rows),
        "services": items(service_rows),
        "sellers": items(seller_rows),
        "new_leads_trend": _series(trend_rows, start_date, days),
        "generated_at": now.isoformat(),
    }


async def get_dashboard_metrics(days: int) -> dict:
    cached = _cache.get(days)
    now_mono = monotonic()
    if cached and cached[0] > now_mono:
        return cached[1]

    async with _cache_lock:
        cached = _cache.get(days)
        now_mono = monotonic()
        if cached and cached[0] > now_mono:
            return cached[1]
        result = await _compute_dashboard_metrics(days)
        _cache[days] = (monotonic() + _CACHE_TTL_SECONDS, result)
        return result
