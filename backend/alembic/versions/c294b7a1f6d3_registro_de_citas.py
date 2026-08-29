"""Registro de citas creadas desde el formulario de Nueva Cita.

Revision ID: c294b7a1f6d3
Revises: db85baad2cf5
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c294b7a1f6d3"
down_revision: Union[str, None] = "db85baad2cf5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "appointments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("nombre_completo", sa.Text(), nullable=False),
        sa.Column("dni", sa.Text(), nullable=False, server_default=""),
        sa.Column("telefono", sa.Text(), nullable=False),
        sa.Column("tratamiento", sa.Text(), nullable=False),
        sa.Column("detalle", sa.Text(), nullable=False, server_default=""),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("hora", sa.Text(), nullable=False),
        sa.Column("vendedor", sa.Text(), nullable=False),
        sa.Column("adelanto", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("comprobante_filename", sa.Text(), nullable=True),
        sa.Column("test_mode", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("n8n_status", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("event_link", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('created', 'duplicate', 'created_with_errors', 'error')",
            name="ck_appointments_status",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_appointments_created", "appointments", [sa.text("created_at DESC")])


def downgrade() -> None:
    op.drop_index("idx_appointments_created", table_name="appointments")
    op.drop_table("appointments")
