"""Seguimiento conversacional de reportes.

Revision ID: b2e8f6d04c53
Revises: a1d7e5c93b42
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b2e8f6d04c53"
down_revision: Union[str, None] = "a1d7e5c93b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "issue_reports",
        sa.Column("priority", sa.Text(), nullable=False, server_default="normal"),
    )
    op.drop_constraint("ck_issue_reports_status", "issue_reports", type_="check")
    op.create_check_constraint(
        "ck_issue_reports_status",
        "issue_reports",
        "status IN ('new', 'in_review', 'needs_info', 'resolved')",
    )
    op.create_check_constraint(
        "ck_issue_reports_priority",
        "issue_reports",
        "priority IN ('low', 'normal', 'high', 'critical')",
    )

    op.create_table(
        "issue_report_comments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["report_id"], ["issue_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_issue_report_comments_report_created",
        "issue_report_comments",
        ["report_id", "created_at"],
    )

    op.create_table(
        "issue_report_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("report_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("previous_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["report_id"], ["issue_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_issue_report_events_report_created",
        "issue_report_events",
        ["report_id", "created_at"],
    )

    op.execute(
        """
        INSERT INTO issue_report_events (report_id, actor_user_id, event_type, new_value, created_at)
        SELECT id, reporter_user_id, 'created', status, created_at
        FROM issue_reports
        """
    )


def downgrade() -> None:
    op.drop_index("idx_issue_report_events_report_created", table_name="issue_report_events")
    op.drop_table("issue_report_events")
    op.drop_index("idx_issue_report_comments_report_created", table_name="issue_report_comments")
    op.drop_table("issue_report_comments")
    op.drop_constraint("ck_issue_reports_priority", "issue_reports", type_="check")
    op.drop_constraint("ck_issue_reports_status", "issue_reports", type_="check")
    op.execute("UPDATE issue_reports SET status = 'in_review' WHERE status = 'needs_info'")
    op.create_check_constraint(
        "ck_issue_reports_status",
        "issue_reports",
        "status IN ('new', 'in_review', 'resolved')",
    )
    op.drop_column("issue_reports", "priority")
