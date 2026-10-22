"""Escrituras de los reportes de problemas. Las lecturas viven en queries.py."""

from datetime import datetime, timezone

from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from app.core.time_format import iso_utc
from app.db.models.auth import User
from app.db.models.reports import IssueReport, IssueReportAttachment, IssueReportComment, IssueReportEvent
from app.db.uow import session_scope
from app.modules.issue_reports.queries import get_issue_report
from app.modules.issue_reports.types import IssueReportPriority, IssueReportStatus


class InvalidReportContextError(Exception):
    """El lead o el usuario al que el reporte hace referencia ya no existe."""


async def create_issue_report(values: dict, attachments: list[dict], reporter_user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    try:
        async with session_scope() as session:
            report_id = (await session.execute(
                insert(IssueReport).values(
                    reporter_user_id=reporter_user_id,
                    title=values["title"],
                    description=values["description"],
                    status=IssueReportStatus.NEW,
                    priority=IssueReportPriority.NORMAL,
                    current_path=values["current_path"],
                    lead_id=values.get("lead_id"),
                    technical_context=values.get("technical_context") or {},
                    created_at=now,
                    updated_at=now,
                ).returning(IssueReport.id)
            )).scalar_one()
            if attachments:
                await session.execute(insert(IssueReportAttachment), [
                    {**attachment, "report_id": report_id, "created_at": now}
                    for attachment in attachments
                ])
            await session.execute(insert(IssueReportEvent).values(
                report_id=report_id,
                actor_user_id=reporter_user_id,
                event_type="created",
                previous_value=None,
                new_value=IssueReportStatus.NEW,
                created_at=now,
            ))
            await session.flush()
    except IntegrityError as exc:
        raise InvalidReportContextError(
            "El contexto del reporte ya no es válido"
        ) from exc
    report = await get_issue_report(report_id)
    assert report is not None
    return report


async def update_issue_report(
    report_id: int,
    status: IssueReportStatus | None,
    priority: IssueReportPriority | None,
    actor_user_id: int,
) -> dict | None:
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        report = await session.get(IssueReport, report_id)
        if report is None:
            return None
        events = []
        if status is not None and status != report.status:
            events.append({
                "report_id": report_id,
                "actor_user_id": actor_user_id,
                "event_type": "status_changed",
                "previous_value": report.status,
                "new_value": status,
                "created_at": now,
            })
            report.status = status
            resolved = status == IssueReportStatus.RESOLVED
            report.resolved_at = now if resolved else None
            report.resolved_by_user_id = actor_user_id if resolved else None
        if priority is not None and priority != report.priority:
            events.append({
                "report_id": report_id,
                "actor_user_id": actor_user_id,
                "event_type": "priority_changed",
                "previous_value": report.priority,
                "new_value": priority,
                "created_at": now,
            })
            report.priority = priority
        if events:
            report.updated_at = now
            await session.execute(insert(IssueReportEvent), events)
        await session.flush()
    return await get_issue_report(report_id)


async def create_issue_report_comment(report_id: int, author_user_id: int, content: str) -> dict:
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        comment_id = (await session.execute(
            insert(IssueReportComment).values(
                report_id=report_id,
                author_user_id=author_user_id,
                content=content,
                created_at=now,
            ).returning(IssueReportComment.id)
        )).scalar_one()
        report = await session.get(IssueReport, report_id)
        if report is not None:
            report.updated_at = now
        await session.flush()
        row = (await session.execute(
            select(
                IssueReportComment.id,
                IssueReportComment.author_user_id,
                User.name.label("author_name"),
                User.role.label("author_role"),
                IssueReportComment.content,
                IssueReportComment.created_at,
            )
            .join(User, User.id == IssueReportComment.author_user_id)
            .where(IssueReportComment.id == comment_id)
        )).mappings().one()
    return {
        "id": row["id"],
        "author_user_id": row["author_user_id"],
        "author_name": row["author_name"],
        "author_role": row["author_role"],
        "content": row["content"],
        "created_at": iso_utc(row["created_at"]),
    }
