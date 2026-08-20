from datetime import datetime, timezone

from sqlalchemy import func, insert, select
from sqlalchemy.orm import aliased

from db.models import (
    IssueReport,
    IssueReportAttachment,
    IssueReportComment,
    IssueReportEvent,
    User,
)
from domain_types import IssueReportPriority, IssueReportStatus
from db.session import get_sessionmaker


Reporter = aliased(User)
Resolver = aliased(User)
CommentAuthor = aliased(User)
EventActor = aliased(User)


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


def _public_code(report_id: int) -> str:
    return f"REP-{report_id:06d}"


def _report_query():
    return (
        select(
            IssueReport.id,
            IssueReport.reporter_user_id,
            Reporter.name.label("reporter_name"),
            IssueReport.title,
            IssueReport.description,
            IssueReport.status,
            IssueReport.priority,
            IssueReport.current_path,
            IssueReport.lead_id,
            IssueReport.technical_context,
            IssueReport.resolved_at,
            Resolver.name.label("resolved_by_name"),
            IssueReport.created_at,
            IssueReport.updated_at,
            select(func.count(IssueReportComment.id))
            .where(IssueReportComment.report_id == IssueReport.id)
            .correlate(IssueReport)
            .scalar_subquery()
            .label("comment_count"),
        )
        .join(Reporter, Reporter.id == IssueReport.reporter_user_id)
        .outerjoin(Resolver, Resolver.id == IssueReport.resolved_by_user_id)
    )


async def _attachments_by_report(report_ids: list[int]) -> dict[int, list[dict]]:
    if not report_ids:
        return {}
    stmt = (
        select(IssueReportAttachment)
        .where(IssueReportAttachment.report_id.in_(report_ids))
        .order_by(IssueReportAttachment.id.asc())
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).scalars().all()
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row.report_id, []).append({
            "id": row.id,
            "media_url": row.media_url,
            "filename": row.filename,
            "content_type": row.content_type,
            "size_bytes": row.size_bytes,
        })
    return grouped


def _serialize(row, attachments: list[dict]) -> dict:
    return {
        "id": row["id"],
        "public_code": _public_code(row["id"]),
        "reporter_user_id": row["reporter_user_id"],
        "reporter_name": row["reporter_name"],
        "title": row["title"],
        "description": row["description"],
        "status": row["status"],
        "priority": row["priority"],
        "current_path": row["current_path"],
        "lead_id": row["lead_id"],
        "technical_context": row["technical_context"] or {},
        "attachments": attachments,
        "comment_count": row["comment_count"],
        "resolved_at": _ts(row["resolved_at"]),
        "resolved_by_name": row["resolved_by_name"],
        "created_at": _ts(row["created_at"]),
        "updated_at": _ts(row["updated_at"]),
    }


async def list_issue_reports(
    user_id: int,
    is_admin: bool,
    status: str | None = None,
    priority: str | None = None,
) -> list[dict]:
    stmt = _report_query()
    if not is_admin:
        stmt = stmt.where(IssueReport.reporter_user_id == user_id)
    if status:
        stmt = stmt.where(IssueReport.status == status)
    if priority:
        stmt = stmt.where(IssueReport.priority == priority)
    stmt = stmt.order_by(IssueReport.created_at.desc(), IssueReport.id.desc()).limit(500)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    attachments = await _attachments_by_report([row["id"] for row in rows])
    return [_serialize(row, attachments.get(row["id"], [])) for row in rows]


async def get_issue_report(report_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            _report_query().where(IssueReport.id == report_id)
        )).mappings().one_or_none()
    if row is None:
        return None
    attachments = await _attachments_by_report([report_id])
    return _serialize(row, attachments.get(report_id, []))


async def get_issue_report_detail(report_id: int) -> dict | None:
    report = await get_issue_report(report_id)
    if report is None:
        return None
    comments_stmt = (
        select(
            IssueReportComment.id,
            IssueReportComment.author_user_id,
            CommentAuthor.name.label("author_name"),
            CommentAuthor.role.label("author_role"),
            IssueReportComment.content,
            IssueReportComment.created_at,
        )
        .join(CommentAuthor, CommentAuthor.id == IssueReportComment.author_user_id)
        .where(IssueReportComment.report_id == report_id)
        .order_by(IssueReportComment.created_at.asc(), IssueReportComment.id.asc())
    )
    events_stmt = (
        select(
            IssueReportEvent.id,
            EventActor.name.label("actor_name"),
            IssueReportEvent.event_type,
            IssueReportEvent.previous_value,
            IssueReportEvent.new_value,
            IssueReportEvent.created_at,
        )
        .outerjoin(EventActor, EventActor.id == IssueReportEvent.actor_user_id)
        .where(IssueReportEvent.report_id == report_id)
        .order_by(IssueReportEvent.created_at.asc(), IssueReportEvent.id.asc())
    )
    async with get_sessionmaker()() as session:
        comment_rows = (await session.execute(comments_stmt)).mappings().all()
        event_rows = (await session.execute(events_stmt)).mappings().all()
    report["comments"] = [{
        "id": row["id"],
        "author_user_id": row["author_user_id"],
        "author_name": row["author_name"],
        "author_role": row["author_role"],
        "content": row["content"],
        "created_at": _ts(row["created_at"]),
    } for row in comment_rows]
    report["events"] = [{
        "id": row["id"],
        "actor_name": row["actor_name"],
        "event_type": row["event_type"],
        "previous_value": row["previous_value"],
        "new_value": row["new_value"],
        "created_at": _ts(row["created_at"]),
    } for row in event_rows]
    return report


async def create_issue_report(values: dict, attachments: list[dict], reporter_user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
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
        await session.commit()
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
    async with get_sessionmaker()() as session:
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
        await session.commit()
    return await get_issue_report(report_id)


async def create_issue_report_comment(report_id: int, author_user_id: int, content: str) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
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
        await session.commit()
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
        "created_at": _ts(row["created_at"]),
    }


async def list_active_admin_ids() -> list[int]:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(User.id).where(User.role == "admin", User.is_active.is_(True))
        )).scalars().all()
    return list(rows)
