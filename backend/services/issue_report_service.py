from datetime import datetime, timezone

from sqlalchemy import insert, select, update
from sqlalchemy.orm import aliased

from db.models import IssueReport, IssueReportAttachment, User
from domain_types import IssueReportStatus
from db.session import get_sessionmaker


Reporter = aliased(User)
Resolver = aliased(User)


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
            IssueReport.current_path,
            IssueReport.lead_id,
            IssueReport.technical_context,
            IssueReport.resolved_at,
            Resolver.name.label("resolved_by_name"),
            IssueReport.created_at,
            IssueReport.updated_at,
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
        "current_path": row["current_path"],
        "lead_id": row["lead_id"],
        "technical_context": row["technical_context"] or {},
        "attachments": attachments,
        "resolved_at": _ts(row["resolved_at"]),
        "resolved_by_name": row["resolved_by_name"],
        "created_at": _ts(row["created_at"]),
        "updated_at": _ts(row["updated_at"]),
    }


async def list_issue_reports(user_id: int, is_admin: bool, status: str | None = None) -> list[dict]:
    stmt = _report_query()
    if not is_admin:
        stmt = stmt.where(IssueReport.reporter_user_id == user_id)
    if status:
        stmt = stmt.where(IssueReport.status == status)
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


async def create_issue_report(values: dict, attachments: list[dict], reporter_user_id: int) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        report_id = (await session.execute(
            insert(IssueReport).values(
                reporter_user_id=reporter_user_id,
                title=values["title"],
                description=values["description"],
                status=IssueReportStatus.NEW,
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
        await session.commit()
    report = await get_issue_report(report_id)
    assert report is not None
    return report


async def update_issue_report_status(report_id: int, status: IssueReportStatus, actor_user_id: int) -> dict | None:
    now = datetime.now(timezone.utc)
    resolved = status == IssueReportStatus.RESOLVED
    async with get_sessionmaker()() as session:
        result = await session.execute(
            update(IssueReport)
            .where(IssueReport.id == report_id)
            .values(
                status=status,
                updated_at=now,
                resolved_at=now if resolved else None,
                resolved_by_user_id=actor_user_id if resolved else None,
            )
        )
        await session.commit()
    return await get_issue_report(report_id) if result.rowcount else None


async def list_active_admin_ids() -> list[int]:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(User.id).where(User.role == "admin", User.is_active.is_(True))
        )).scalars().all()
    return list(rows)
