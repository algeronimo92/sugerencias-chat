"""Etapa a la que pasa un lead al agendarle una cita.

Revision ID: c7d4a1e9b263
Revises: b5e1d7c3a920
Create Date: 2026-11-05

Agendar desde el lead mueve el lead a la etapa que el negocio eligió. Las
etapas son de cada negocio y ninguna significa "cita" para el código, así que
la elección es una marca en la etapa. El índice parcial garantiza que haya a
lo sumo una marcada; ninguna marcada significa que agendar no mueve el lead.

Plano tenant: corre en cada schema, como la tabla.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c7d4a1e9b263"
down_revision: Union[str, None] = "b5e1d7c3a920"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "lead_stages",
        sa.Column("on_appointment", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index(
        "uq_lead_stages_on_appointment",
        "lead_stages",
        ["on_appointment"],
        unique=True,
        postgresql_where=sa.text("on_appointment"),
    )


def downgrade() -> None:
    op.drop_index("uq_lead_stages_on_appointment", table_name="lead_stages")
    op.drop_column("lead_stages", "on_appointment")
