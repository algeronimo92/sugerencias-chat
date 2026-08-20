"""Reportes de problemas con evidencias.

Revision ID: a1d7e5c93b42
Revises: f3a7c8e29b41
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a1d7e5c93b42"
down_revision: Union[str, None] = "f3a7c8e29b41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "issue_reports",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("reporter_user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="new"),
        sa.Column("current_path", sa.Text(), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("technical_context", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('new', 'in_review', 'resolved')", name="ck_issue_reports_status"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["resolved_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_issue_reports_status_created", "issue_reports", ["status", sa.text("created_at DESC")])
    op.create_index("idx_issue_reports_reporter_created", "issue_reports", ["reporter_user_id", sa.text("created_at DESC")])

    op.create_table(
        "issue_report_attachments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("media_url", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["report_id"], ["issue_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("media_url"),
    )
    op.create_index("idx_issue_report_attachments_report", "issue_report_attachments", ["report_id"])


def downgrade() -> None:
    op.drop_index("idx_issue_report_attachments_report", table_name="issue_report_attachments")
    op.drop_table("issue_report_attachments")
    op.drop_index("idx_issue_reports_reporter_created", table_name="issue_reports")
    op.drop_index("idx_issue_reports_status_created", table_name="issue_reports")
    op.drop_table("issue_reports")
