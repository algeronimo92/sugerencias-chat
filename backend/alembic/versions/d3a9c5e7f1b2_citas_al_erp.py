"""Citas que se envían al ERP del negocio.

Revision ID: d3a9c5e7f1b2
Revises: b8e3f1a6c2d4

La cita agendada en el CRM se manda al ERP para que aparezca en su agenda con
paciente, paquete y adelanto. La cita guarda qué paquete del ERP se eligió,
cómo se pagó el adelanto, dónde quedó el comprobante (antes solo se reenviaba
a n8n y se perdía) y el resultado del envío, igual que ya hace con Google
Calendar.

Plano tenant: corre en cada schema; donde no está la tabla no hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d3a9c5e7f1b2"
down_revision: Union[str, None] = "b8e3f1a6c2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "appointments"
TEXT_COLUMNS = (
    "erp_package_id", "package_name", "payment_method", "comprobante_url",
    "erp_appointment_id", "erp_link", "erp_sync_error",
)


def upgrade() -> None:
    bind = op.get_bind()
    # Plano tenant: migrate.py también corre la cadena sobre public, que no
    # tiene ``appointments`` (ver test_public_plane_migrations_postgres).
    if not _table_exists(bind) or _column_exists(bind, "erp_sync_status"):
        return
    for column in TEXT_COLUMNS:
        op.add_column(TABLE, sa.Column(column, sa.Text(), nullable=True))
    op.add_column(TABLE, sa.Column(
        "erp_sync_status", sa.Text(), nullable=False, server_default="not_configured",
    ))
    op.create_check_constraint(
        "ck_appointments_erp_sync", TABLE,
        "erp_sync_status IN ('not_configured', 'pending', 'synced', 'error', 'skipped')",
    )
    op.create_check_constraint(
        "ck_appointments_payment_method", TABLE,
        "payment_method IS NULL OR payment_method IN ('cash', 'card', 'transfer', 'yape', 'plin')",
    )


def _table_exists(bind) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": TABLE}).first() is not None


def _column_exists(bind, column: str) -> bool:
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column"
    ), {"table": TABLE, "column": column}).first() is not None


def downgrade() -> None:
    if not _table_exists(op.get_bind()):
        return
    op.drop_constraint("ck_appointments_payment_method", TABLE, type_="check")
    op.drop_constraint("ck_appointments_erp_sync", TABLE, type_="check")
    op.drop_column(TABLE, "erp_sync_status")
    for column in reversed(TEXT_COLUMNS):
        op.drop_column(TABLE, column)
