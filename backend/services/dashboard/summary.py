"""La fila de KPIs de arriba: una sola consulta con subconsultas escalares.

Va en un `select` único a propósito — son ocho cifras de seis tablas distintas
y cada una por separado sería un round-trip más contra la base en cada refresco
del panel.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from domain_types import AutomationExecutionStatus, TaskStatus
from db.models import Appointment, AutomationExecution, Lead, LeadTask, WspMessage

from .context import DashboardScope, execute_mapping


def _latest_sender():
    """Quién habló último en el chat del lead. Correlacionada con `Lead` para
    poder usarse dentro de los conteos de abajo."""
    return (
        select(WspMessage.sender)
        .where(WspMessage.chat_id == Lead.id)
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
        .limit(1)
        .correlate(Lead)
        .scalar_subquery()
    )


def _avg_response_seconds(scope: DashboardScope):
    """Cuánto tarda el vendedor en contestarle al cliente.

    Por cada mensaje del cliente busca el primer mensaje de vendedor posterior
    en el mismo chat y promedia la diferencia. En scope propio la respuesta que
    cuenta es la que escribió uno mismo (`sent_by_user_id`), no cualquier
    respuesta en un lead asignado a uno: en un chat que atienden dos personas,
    la del otro no mide el tiempo de nadie.
    """
    customer = aliased(WspMessage)
    seller = aliased(WspMessage)
    next_seller_response = (
        select(func.min(seller.sent_at))
        .where(
            seller.chat_id == customer.chat_id,
            seller.sender == "vendedor",
            seller.sent_at > customer.sent_at,
            scope.mine(seller.sent_by_user_id),
        )
        .correlate(customer)
        .scalar_subquery()
    )
    return (
        select(func.avg(func.extract("epoch", next_seller_response - customer.sent_at)))
        .where(
            customer.sender == "cliente",
            customer.sent_at >= scope.start,
            next_seller_response.is_not(None),
        )
        .scalar_subquery()
    )


async def collect(scope: DashboardScope) -> dict:
    mine_lead = scope.mine(Lead.vendedor_id)
    mine_task = scope.mine(LeadTask.assigned_user_id)
    latest_sender = _latest_sender()

    stmt = select(
        select(func.count(Lead.id)).where(mine_lead).scalar_subquery().label("total_leads"),
        select(func.count(Lead.id))
        .where(Lead.created_at >= scope.start, mine_lead)
        .scalar_subquery()
        .label("new_leads"),
        select(func.count(Lead.id))
        .where(latest_sender == "cliente", mine_lead)
        .scalar_subquery()
        .label("awaiting_reply"),
        select(func.count(LeadTask.id))
        .where(LeadTask.status == TaskStatus.PENDING, LeadTask.due_at < scope.now, mine_task)
        .scalar_subquery()
        .label("overdue_tasks"),
        select(func.count(LeadTask.id))
        .where(
            LeadTask.status == TaskStatus.COMPLETED,
            LeadTask.completed_at >= scope.start,
            mine_task,
        )
        .scalar_subquery()
        .label("completed_tasks"),
        _avg_response_seconds(scope).label("avg_response_seconds"),
        select(func.count(Appointment.id))
        .where(
            Appointment.created_at >= scope.start,
            Appointment.status == "created",
            Appointment.test_mode.is_(False),
            scope.mine(Appointment.created_by_user_id),
        )
        .scalar_subquery()
        .label("appointments_created"),
        select(func.count(AutomationExecution.id))
        .where(
            AutomationExecution.created_at >= scope.start,
            AutomationExecution.start_source == "manual",
            scope.mine(AutomationExecution.started_by_user_id),
        )
        .scalar_subquery()
        .label("flows_started"),
        # Mensajes con autor conocido: los que salieron de la app. Los ecos del
        # celular del vendedor no traen usuario y quedan fuera del conteo.
        select(func.count(WspMessage.id))
        .where(
            WspMessage.sent_at >= scope.start,
            WspMessage.sent_by_user_id.is_not(None),
            scope.mine(WspMessage.sent_by_user_id),
        )
        .scalar_subquery()
        .label("messages_sent"),
        select(func.count(AutomationExecution.id))
        .where(
            AutomationExecution.status.in_(
                (
                    AutomationExecutionStatus.SCHEDULED,
                    AutomationExecutionStatus.RUNNING,
                    AutomationExecutionStatus.PAUSED,
                )
            ),
            scope.mine(AutomationExecution.started_by_user_id),
        )
        .scalar_subquery()
        .label("flows_active"),
    )

    row = (await execute_mapping(stmt))[0]
    avg_seconds = row["avg_response_seconds"]
    return {
        "total_leads": int(row["total_leads"] or 0),
        "new_leads": int(row["new_leads"] or 0),
        "awaiting_reply": int(row["awaiting_reply"] or 0),
        "overdue_tasks": int(row["overdue_tasks"] or 0),
        "completed_tasks": int(row["completed_tasks"] or 0),
        "avg_response_minutes": round(float(avg_seconds) / 60, 1) if avg_seconds is not None else None,
        "appointments_created": int(row["appointments_created"] or 0),
        "flows_started": int(row["flows_started"] or 0),
        "messages_sent": int(row["messages_sent"] or 0),
        "flows_active": int(row["flows_active"] or 0),
    }
