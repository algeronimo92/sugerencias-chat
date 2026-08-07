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

logger = logging.getLogger(__name__)

POLL_SECONDS = 20

outbox_pending = Gauge("outbox_pending", "Mensajes en message_outbox en estado pending")
outbox_processing = Gauge("outbox_processing", "Mensajes en message_outbox en estado processing")
outbox_failed = Gauge("outbox_failed", "Mensajes en message_outbox en estado failed")
outbox_oldest_pending_age_seconds = Gauge(
    "outbox_oldest_pending_age_seconds", "Antigüedad del job pending más viejo de message_outbox"
)
outbox_oldest_processing_age_seconds = Gauge(
    "outbox_oldest_processing_age_seconds", "Antigüedad del job processing más viejo de message_outbox"
)
automation_scheduled_due = Gauge(
    "automation_scheduled_due", "Ejecuciones de automatización programadas cuya hora ya pasó"
)
automation_running = Gauge("automation_running", "Ejecuciones de automatización en curso")
automation_failed_last_hour = Gauge(
    "automation_failed_last_hour", "Ejecuciones de automatización que fallaron en la última hora"
)
scheduled_messages_due_unprocessed = Gauge(
    "scheduled_messages_due_unprocessed", "Mensajes programados cuya hora ya pasó y siguen sin procesar"
)
lead_tasks_pending_overdue = Gauge(
    "lead_tasks_pending_overdue", "Tareas de lead pendientes y vencidas"
)
ws_local_connections = Gauge(
    "ws_local_connections", "Conexiones websocket activas en este proceso"
)


async def _update_once() -> None:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        outbox_counts = dict((await session.execute(
            select(MessageOutbox.status, func.count(MessageOutbox.id)).group_by(MessageOutbox.status)
        )).all())
        outbox_pending.set(outbox_counts.get("pending", 0))
        outbox_processing.set(outbox_counts.get("processing", 0))
        outbox_failed.set(outbox_counts.get("failed", 0))

        oldest_pending = await session.scalar(
            select(func.min(MessageOutbox.updated_at)).where(MessageOutbox.status == "pending")
        )
        outbox_oldest_pending_age_seconds.set(
            (now - oldest_pending).total_seconds() if oldest_pending else 0
        )

        oldest_processing = await session.scalar(
            select(func.min(MessageOutbox.updated_at)).where(MessageOutbox.status == "processing")
        )
        outbox_oldest_processing_age_seconds.set(
            (now - oldest_processing).total_seconds() if oldest_processing else 0
        )

        automation_scheduled_due.set(await session.scalar(
            select(func.count(AutomationExecution.id)).where(
                AutomationExecution.status == AutomationExecutionStatus.SCHEDULED,
                AutomationExecution.scheduled_for <= now,
            )
        ) or 0)
        automation_running.set(await session.scalar(
            select(func.count(AutomationExecution.id)).where(
                AutomationExecution.status == AutomationExecutionStatus.RUNNING,
            )
        ) or 0)
        automation_failed_last_hour.set(await session.scalar(
            select(func.count(AutomationExecution.id)).where(
                AutomationExecution.status == AutomationExecutionStatus.FAILED,
                AutomationExecution.finished_at >= now - timedelta(hours=1),
            )
        ) or 0)

        scheduled_messages_due_unprocessed.set(await session.scalar(
            select(func.count(ScheduledMessage.id)).where(
                ScheduledMessage.status == "scheduled",
                ScheduledMessage.scheduled_at <= now,
            )
        ) or 0)

        lead_tasks_pending_overdue.set(await session.scalar(
            select(func.count(LeadTask.id)).where(
                LeadTask.status == TaskStatus.PENDING,
                LeadTask.due_at < now,
            )
        ) or 0)

    ws_local_connections.set(await manager.connection_count())


async def watch_queue_metrics() -> None:
    while True:
        try:
            await _update_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error actualizando métricas de colas para Prometheus")
        await asyncio.sleep(POLL_SECONDS)
