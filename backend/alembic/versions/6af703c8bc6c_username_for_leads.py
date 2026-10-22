"""username for leads

Revision ID: 6af703c8bc6c
Revises: d8f3a6c95b17
Create Date: 2026-09-11 10:21:03.885656
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6af703c8bc6c'
down_revision: Union[str, None] = 'd8f3a6c95b17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
            "leads",
            sa.Column("nombre_usuario", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("leads", "nombre_usuario")
