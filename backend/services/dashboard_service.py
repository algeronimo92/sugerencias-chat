from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from db.models import Lead, LeadStage, LeadTask, User, WspMessage
from db.session import get_sessionmaker


def _series(rows, start_date: date, days: int) -> list[dict]:
    values = {row["day"]: int(row["total"]) for row in rows}
    return [
        {"date": (start_date + timedelta(days=offset)).isoformat(), "value": values.get(start_date + timedelta(days=offset), 0)}
        for offset in range(days)
    ]


async def get_dashboard_metrics(days: int) -> dict:
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

    async with get_sessionmaker()() as session:
        new_leads = await session.scalar(select(func.count(Lead.remote_jid)).where(Lead.created_at >= start)) or 0
        awaiting_reply = await session.scalar(select(func.count(Lead.remote_jid)).where(latest_sender == "cliente")) or 0
        overdue_tasks = await session.scalar(
            select(func.count(LeadTask.id)).where(LeadTask.status == "pending", LeadTask.due_at < now)
        ) or 0
        completed_tasks = await session.scalar(
            select(func.count(LeadTask.id)).where(LeadTask.status == "completed", LeadTask.completed_at >= start)
        ) or 0
        avg_response_seconds = await session.scalar(
            select(func.avg(func.extract("epoch", next_seller_response - customer_message.sent_at))).where(
                customer_message.sender == "cliente",
                customer_message.sent_at >= start,
                next_seller_response.is_not(None),
            )
        )

        stage_rows = (await session.execute(
            select(Lead.estado.label("name"), func.count(Lead.remote_jid).label("value"))
            .group_by(Lead.estado)
            .order_by(func.count(Lead.remote_jid).desc())
        )).mappings().all()
        origin_label = func.coalesce(Lead.origen, "Sin origen")
        origin_rows = (await session.execute(
            select(origin_label.label("name"), func.count(Lead.remote_jid).label("value"))
            .group_by(origin_label)
            .order_by(func.count(Lead.remote_jid).desc()).limit(8)
        )).mappings().all()
        service_label = func.coalesce(Lead.servicio_interes, "Sin servicio")
        service_rows = (await session.execute(
            select(service_label.label("name"), func.count(Lead.remote_jid).label("value"))
            .group_by(service_label)
            .order_by(func.count(Lead.remote_jid).desc()).limit(8)
        )).mappings().all()
        seller_label = func.coalesce(User.name, Lead.vendedor, "Sin asignar")
        seller_rows = (await session.execute(
            select(seller_label.label("name"), func.count(Lead.remote_jid).label("value"))
            .outerjoin(User, User.id == Lead.vendedor_id)
            .group_by(seller_label)
            .order_by(func.count(Lead.remote_jid).desc()).limit(12)
        )).mappings().all()
        local_created_day = func.date(func.timezone("America/Lima", Lead.created_at))
        trend_rows = (await session.execute(
            select(local_created_day.label("day"), func.count(Lead.remote_jid).label("total"))
            .where(Lead.created_at >= start)
            .group_by(local_created_day)
            .order_by(local_created_day)
        )).mappings().all()
        # Se lee al final para incluir leads que puedan entrar mientras se
        # calculan los agregados y evitar temporalmente nuevos > total.
        total_leads = await session.scalar(select(func.count(Lead.remote_jid))) or 0

    stages = {stage.value: 0 for stage in LeadStage}
    for row in stage_rows:
        key = row["name"].value if isinstance(row["name"], LeadStage) else str(row["name"])
        stages[key] = int(row["value"])

    def items(rows):
        return [{"name": str(row["name"]), "value": int(row["value"])} for row in rows]

    return {
        "period_days": days,
        "summary": {
            "total_leads": int(total_leads),
            "new_leads": int(new_leads),
            "awaiting_reply": int(awaiting_reply),
            "overdue_tasks": int(overdue_tasks),
            "completed_tasks": int(completed_tasks),
            "avg_response_minutes": round(float(avg_response_seconds) / 60, 1) if avg_response_seconds is not None else None,
        },
        "stages": [{"name": stage.value, "value": stages[stage.value]} for stage in LeadStage],
        "origins": items(origin_rows),
        "services": items(service_rows),
        "sellers": items(seller_rows),
        "new_leads_trend": _series(trend_rows, start_date, days),
        "generated_at": now.isoformat(),
    }
