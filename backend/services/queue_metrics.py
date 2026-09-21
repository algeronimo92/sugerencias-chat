"""Gauges de Prometheus sobre el estado de las colas de negocio.

docs/analisis/07-analisis-mensajeria.md §5.7 marca esto como la carencia más
subestimada del sistema: un job zombi o una automatización rota no generan
ninguna señal hasta que un cliente se queja. Estos gauges quedan expuestos en
`/metrics` (junto a los que agrega prometheus-fastapi-instrumentator) para que
Prometheus/Alertmanager puedan avisar antes de que eso pase.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from prometheus_client import Gauge
from sqlalchemy import func, select

from db.models import AutomationExecution, LeadTask, MessageOutbox, ScheduledMessage
from db.session import get_sessionmaker
from domain_types import AutomationExecutionStatus, TaskStatus
from services.ws_manager import manager
from tenancy.context import get_current_tenant

logger = logging.getLogger(__name__)

POLL_SECONDS = 20

TENANT_LABEL = ["organization_id"]


def _gauge(name: str, description: str) -> Gauge:
    return Gauge(name, description, TENANT_LABEL)


def _set(metric: Gauge, value: float | int) -> None:
    context = get_current_tenant()
    scope = str(context.organization_id) if context else "legacy"
    metric.labels(organization_id=scope).set(value)


outbox_pending = _gauge("outbox_pending", "Mensajes en message_outbox en estado pending")
outbox_processing = _gauge("outbox_processing", "Mensajes en message_outbox en estado processing")
outbox_failed = _gauge("outbox_failed", "Mensajes en message_outbox en estado failed")
# `outbox_failed` cuenta el acumulado histórico: nada purga la tabla y un job
# solo sale de failed por reintento manual, así que unos pocos fallos viejos
# que nadie reintentó lo dejan por encima de cualquier umbral para siempre.
# Sirve para el dashboard, pero como alerta era ruido permanente. Esta versión
# con ventana es la que se vigila: se apaga sola cuando el incidente pasa.
outbox_failed_last_hour = _gauge(
    "outbox_failed_last_hour", "Mensajes de message_outbox que agotaron sus intentos en la última hora"
)
# Fallos que alguien revisó y decidió no reenviar. Se cuentan aparte para que
# cerrarlos no los haga desaparecer del panel: siguen siendo mensajes que el
# cliente nunca recibió.
outbox_discarded = _gauge("outbox_discarded", "Mensajes fallidos descartados a mano en message_outbox")
outbox_oldest_pending_age_seconds = _gauge(
    "outbox_oldest_pending_age_seconds", "Antigüedad del job pending más viejo de message_outbox"
)
outbox_oldest_processing_age_seconds = _gauge(
    "outbox_oldest_processing_age_seconds", "Antigüedad del job processing más viejo de message_outbox"
)
automation_scheduled_due = _gauge(
    "automation_scheduled_due", "Ejecuciones de automatización programadas cuya hora ya pasó"
)
automation_running = _gauge("automation_running", "Ejecuciones de automatización en curso")
automation_failed_last_hour = _gauge(
    "automation_failed_last_hour", "Ejecuciones de automatización que fallaron en la última hora"
)
scheduled_messages_due_unprocessed = _gauge(
    "scheduled_messages_due_unprocessed", "Mensajes programados cuya hora ya pasó y siguen sin procesar"
)
lead_tasks_pending_overdue = _gauge(
    "lead_tasks_pending_overdue", "Tareas de lead pendientes y vencidas"
)
ws_local_connections = _gauge(
    "ws_local_connections", "Conexiones websocket activas en este proceso"
)


async def _update_once() -> None:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        outbox_counts = dict((await session.execute(
            select(MessageOutbox.status, func.count(MessageOutbox.id)).group_by(MessageOutbox.status)
        )).all())
        _set(outbox_pending, outbox_counts.get("pending", 0))
        _set(outbox_processing, outbox_counts.get("processing", 0))
        _set(outbox_failed, outbox_counts.get("failed", 0))
        _set(outbox_discarded, outbox_counts.get("discarded", 0))
        # updated_at es la marca del intento que agotó MAX_ATTEMPTS
        # (`_mark_failed` lo escribe), y el reintento manual lo reescribe al
        # sacar la fila de failed: sirve como "cuándo falló esto".
        _set(outbox_failed_last_hour, await session.scalar(
            select(func.count(MessageOutbox.id)).where(
                MessageOutbox.status == "failed",
                MessageOutbox.updated_at >= now - timedelta(hours=1),
            )
        ) or 0)

        oldest_pending = await session.scalar(
            select(func.min(MessageOutbox.updated_at)).where(MessageOutbox.status == "pending")
        )
        _set(outbox_oldest_pending_age_seconds,
            (now - oldest_pending).total_seconds() if oldest_pending else 0
        )

        oldest_processing = await session.scalar(
            select(func.min(MessageOutbox.updated_at)).where(MessageOutbox.status == "processing")
        )
        _set(outbox_oldest_processing_age_seconds,
            (now - oldest_processing).total_seconds() if oldest_processing else 0
        )

        _set(automation_scheduled_due, await session.scalar(
            select(func.count(AutomationExecution.id)).where(
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                AutomationExecution.scheduled_for <= now,
            )
        ) or 0)
        _set(automation_running, await session.scalar(
            select(func.count(AutomationExecution.id)).where(
                AutomationExecution.status == AutomationExecutionStatus.RUNNING,
            )
        ) or 0)
        _set(automation_failed_last_hour, await session.scalar(
            select(func.count(AutomationExecution.id)).where(
                AutomationExecution.status == AutomationExecutionStatus.FAILED,
                AutomationExecution.finished_at >= now - timedelta(hours=1),
            )
        ) or 0)

        _set(scheduled_messages_due_unprocessed, await session.scalar(
            select(func.count(ScheduledMessage.id)).where(
                ScheduledMessage.status == "scheduled",
                ScheduledMessage.scheduled_at <= now,
            )
        ) or 0)

        _set(lead_tasks_pending_overdue, await session.scalar(
            select(func.count(LeadTask.id)).where(
                LeadTask.status == TaskStatus.PENDING,
                LeadTask.due_at < now,
            )
        ) or 0)

    _set(ws_local_connections, await manager.connection_count())


async def watch_queue_metrics() -> None:
    while True:
        try:
            await _update_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error actualizando métricas de colas para Prometheus")
        await asyncio.sleep(POLL_SECONDS)
