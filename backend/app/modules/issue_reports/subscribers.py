"""Avisos de los reportes de problemas, después del commit.

El reporte ya quedó persistido cuando corren: un aviso que falla se
registra y no convierte ese éxito en un error que invite a reenviarlo.
"""

from __future__ import annotations

import logging

from app.core.events import Phase, subscribe
from app.modules.issue_reports.events import (
    IssueReportCommented,
    IssueReportFiled,
    IssueReportsChanged,
    IssueReportStatusChanged,
)
from app.modules.issue_reports.queries import list_active_admin_ids
from app.modules.notifications.ports.push_service import send_push_to_user
from app.modules.notifications.ports.service import create_system_notification
from app.realtime.ws_manager import manager
from app.modules.notifications.ports.types import NotificationType

logger = logging.getLogger(__name__)


async def _notify(user_id: int, title: str, body: str, report_id: int) -> None:
    notification = await create_system_notification(
        user_id,
        NotificationType.ISSUE_REPORT,
        title,
        body,
        source_id=str(report_id),
        metadata={"issue_report_id": report_id},
    )
    await manager.send_to_user(user_id, {"type": "notification_created", "notification": notification})
    await send_push_to_user(user_id, title, body, f"/reports?report={report_id}", tag=f"issue-report-{report_id}")


@subscribe(IssueReportFiled, phase=Phase.AFTER_COMMIT)
async def notify_admins_of_new_report(event: IssueReportFiled) -> None:
    try:
        for admin_id in await list_active_admin_ids():
            if admin_id == event.reporter_id:
                continue
            await _notify(
                admin_id, f"Nuevo reporte {event.public_code}", f"{event.reporter_name}: {event.title}", event.report_id,
            )
    except Exception:
        logger.exception("No se pudo avisar a los administradores del reporte %s", event.report_id)


@subscribe(IssueReportStatusChanged, phase=Phase.AFTER_COMMIT)
async def notify_reporter_of_status(event: IssueReportStatusChanged) -> None:
    try:
        await _notify(event.reporter_id, f"{event.public_code} · {event.status_label}", event.title, event.report_id)
    except Exception:
        logger.exception("No se pudo avisar al autor del reporte %s", event.report_id)


@subscribe(IssueReportCommented, phase=Phase.AFTER_COMMIT)
async def notify_comment(event: IssueReportCommented) -> None:
    try:
        for recipient_id in dict.fromkeys(event.recipient_ids):
            if recipient_id == event.author_id:
                continue
            await _notify(
                recipient_id, f"Nuevo comentario en {event.public_code}", f"{event.author_name}: {event.content}",
                event.report_id,
            )
    except Exception:
        logger.exception("No se pudo avisar del comentario en el reporte %s", event.report_id)


@subscribe(IssueReportsChanged, phase=Phase.AFTER_COMMIT)
async def announce_reports_changed(event: IssueReportsChanged) -> None:
    await manager.broadcast({"type": "issue_reports_updated"})
