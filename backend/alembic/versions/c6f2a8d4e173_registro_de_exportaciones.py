"""Registro de exportaciones a Excel.

Revision ID: c6f2a8d4e173
Revises: a3d7e9b1c5f2

Cada descarga de datos del negocio deja una fila con quién la pidió, qué
reporte, de qué período y cuántas filas salieron.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c6f2a8d4e173"
down_revision: Union[str, None] = "a3d7e9b1c5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "data_exports"


def upgrade() -> None:
    bind = op.get_bind()
    # Plano tenant. migrate.py también corre la cadena sobre public, que en
    # producción ya no tiene ``users``: el deploy se detuvo cuatro veces por
    # una revisión sin esta guarda (ver test_public_plane_migrations_postgres).
    if not _table_exists(bind, "users") or _table_exists(bind, TABLE):
        return
    op.create_table(
        "data_exports",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("report", sa.Text(), nullable=False),
        sa.Column("period_days", sa.Integer(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "report IN ('separaciones', 'vendedoras', 'leads', 'respaldo')",
            name="data_exports_report_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_data_exports_created", "data_exports", [sa.text("created_at DESC")])
    op.create_index("idx_data_exports_user", "data_exports", ["user_id"])


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
