"""Modelos ORM del dominio tasks."""

from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from domain_types import TaskPriority, TaskStatus, TaskType
from app.db.base import Base


class LeadTask(Base):
    __tablename__ = "lead_tasks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lead_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    task_type: Mapped[str] = mapped_column(Text, default=TaskType.FOLLOW_UP)
    status: Mapped[str] = mapped_column(Text, default=TaskStatus.PENDING)
    priority: Mapped[str] = mapped_column(Text, default=TaskPriority.NORMAL)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_lead_tasks_assignee_status_due", assigned_user_id, status, due_at),
        Index("idx_lead_tasks_lead_status_due", lead_id, status, due_at),
        Index("idx_lead_tasks_created_by", created_by_user_id),
        Index("idx_lead_tasks_completed_by", completed_by_user_id),
        Index("idx_lead_tasks_due_pending", due_at, postgresql_where=text("status = 'pending'")),
        Index(
            "idx_lead_tasks_pending_reminder",
            remind_at,
            postgresql_where=text("status = 'pending' AND reminder_sent_at IS NULL"),
        ),
    )
