"""Modelos ORM del dominio reports."""

from datetime import datetime
from typing import Any
from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.modules.issue_reports.ports.types import IssueReportPriority, IssueReportStatus
from app.db.base import Base


class IssueReport(Base):
    __tablename__ = "issue_reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    reporter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, default=IssueReportStatus.NEW, server_default=IssueReportStatus.NEW.value,
    )
    priority: Mapped[str] = mapped_column(
        Text, default=IssueReportPriority.NORMAL, server_default=IssueReportPriority.NORMAL.value,
    )
    current_path: Mapped[str] = mapped_column(Text)
    lead_id: Mapped[str | None] = mapped_column(
        PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL")
    )
    technical_context: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'in_review', 'needs_info', 'resolved')",
            name="ck_issue_reports_status",
        ),
        CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'critical')",
            name="ck_issue_reports_priority",
        ),
        Index("idx_issue_reports_status_created", status, created_at.desc()),
        Index("idx_issue_reports_reporter_created", reporter_user_id, created_at.desc()),
    )


class IssueReportAttachment(Base):
    __tablename__ = "issue_report_attachments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(
        ForeignKey("issue_reports.id", ondelete="CASCADE")
    )
    media_url: Mapped[str] = mapped_column(Text, unique=True)
    filename: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_issue_report_attachments_report", report_id),)


class IssueReportComment(Base):
    __tablename__ = "issue_report_comments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("issue_reports.id", ondelete="CASCADE"))
    author_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_issue_report_comments_report_created", report_id, created_at),)


class IssueReportEvent(Base):
    __tablename__ = "issue_report_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("issue_reports.id", ondelete="CASCADE"))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    event_type: Mapped[str] = mapped_column(Text)
    previous_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "event_type IN ('created', 'status_changed', 'priority_changed')",
            name="issue_report_events_event_type_check",
        ),
        Index("idx_issue_report_events_report_created", report_id, created_at),
    )
