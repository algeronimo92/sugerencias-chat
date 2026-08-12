"""Catálogo consistente de servicios de interés.

Revision ID: e2c6a8f41d73
Revises: c7f9a3b52e18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e2c6a8f41d73"
down_revision: Union[str, None] = "c7f9a3b52e18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lead_services",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("idx_lead_services_created_by", "lead_services", ["created_by"])
    op.create_index(
        "uq_lead_services_name_lower",
        "lead_services",
        [sa.text("lower(name)")],
        unique=True,
    )

    # Todo valor histórico pasa a ser una opción seleccionable. MIN escoge una
    # grafía estable cuando ya existían variantes que solo diferían en casing.
    op.execute(
        """
        INSERT INTO lead_services (name, is_active, created_at)
        SELECT MIN(btrim(servicio_interes)), true, now()
        FROM leads
        WHERE NULLIF(btrim(servicio_interes), '') IS NOT NULL
        GROUP BY lower(btrim(servicio_interes))
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE leads AS lead
        SET servicio_interes = service.name
        FROM lead_services AS service
        WHERE lower(btrim(lead.servicio_interes)) = lower(service.name)
          AND lead.servicio_interes IS DISTINCT FROM service.name
        """
    )


def downgrade() -> None:
    op.drop_index("uq_lead_services_name_lower", table_name="lead_services")
    op.drop_index("idx_lead_services_created_by", table_name="lead_services")
    op.drop_table("lead_services")
