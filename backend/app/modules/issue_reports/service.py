"""Comandos de los reportes de problemas. Cada uno corre en su unidad de
trabajo y registra el evento que avisa a quien corresponde después del
commit. Las lecturas viven en queries.py."""

from __future__ import annotations

from app.db.uow import collect, unit_of_work
from app.modules.issue_reports import repository
from app.modules.issue_reports.events import (
    IssueReportCommented,
    IssueReportFiled,
    IssueReportsChanged,
    IssueReportStatusChanged,
)
from app.modules.issue_reports.queries import get_issue_report, list_active_admin_ids
from app.modules.issue_reports.repository import InvalidReportContextError
from app.modules.issue_reports.types import IssueReportPriority, IssueReportStatus

__all__ = [
    "InvalidReportContextError",
    "comment_issue_report",
    "file_issue_report",
    "list_active_admin_ids",
    "update_issue_report",
]

STATUS_LABELS = {
    IssueReportStatus.NEW.value: "Nuevo",
    IssueReportStatus.IN_REVIEW.value: "En revisión",
    IssueReportStatus.NEEDS_INFO.value: "Necesita información",
    IssueReportStatus.RESOLVED.value: "Resuelto",
}


async def file_issue_report(values: dict, attachments: list[dict], *, reporter_id: int, reporter_name: str) -> dict:
    async with unit_of_work():
        report = await repository.create_issue_report(values, attachments, reporter_id)
        collect(IssueReportFiled(
            report_id=report["id"], public_code=report["public_code"], title=report["title"],
            reporter_id=reporter_id, reporter_name=reporter_name,
        ))
    return report


async def update_issue_report(
    report_id: int,
    status: IssueReportStatus | None,
    priority: IssueReportPriority | None,
    actor_user_id: int,
) -> dict | None:
    """El autor se entera cuando un admin le cambia el estado; cualquier otro
    cambio solo refresca las listas."""
    async with unit_of_work():
        previous = await get_issue_report(report_id)
        if previous is None:
            return None
        report = await repository.update_issue_report(report_id, status, priority, actor_user_id)
        if report["reporter_user_id"] != actor_user_id and previous["status"] != report["status"]:
            collect(IssueReportStatusChanged(
                report_id=report["id"], public_code=report["public_code"], title=report["title"],
                status_label=STATUS_LABELS[report["status"]], reporter_id=report["reporter_user_id"],
            ))
        else:
            collect(IssueReportsChanged())
    return report


async def comment_issue_report(report: dict, *, author_id: int, author_name: str, author_is_admin: bool, content: str) -> dict:
    """Si comenta un admin se entera el autor; si comenta el autor, los admins."""
    async with unit_of_work():
        comment = await repository.create_issue_report_comment(report["id"], author_id, content)
        recipients = [report["reporter_user_id"]] if author_is_admin else await list_active_admin_ids()
        collect(IssueReportCommented(
            report_id=report["id"], public_code=report["public_code"], author_id=author_id,
            author_name=author_name, content=content, recipient_ids=tuple(recipients),
        ))
    return comment
