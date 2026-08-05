"""invocacion entre flujos

Revision ID: c8e4a1f72b90
Revises: b3d8f5c1a927
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c8e4a1f72b90"
down_revision: Union[str, None] = "b3d8f5c1a927"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_automation_executions_start_source", "automation_executions", type_="check"
    )
    op.create_check_constraint(
        "ck_automation_executions_start_source",
        "automation_executions",
        "start_source IN ('system', 'manual', 'flow')",
    )


def downgrade() -> None:
    op.execute("UPDATE automation_executions SET start_source = 'system' WHERE start_source = 'flow'")
    op.drop_constraint(
        "ck_automation_executions_start_source", "automation_executions", type_="check"
    )
    op.create_check_constraint(
        "ck_automation_executions_start_source",
        "automation_executions",
        "start_source IN ('system', 'manual')",
    )
