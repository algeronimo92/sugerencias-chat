"""Se borra lead_sales: el negocio no registra compras en el CRM.

Revision ID: e4b8d2f6a913
Revises: c8d3e5f7a9b1
Create Date: 2026-11-09

"Registrar compra" se quitó de la app: la venta del negocio es la separación
de cita con su adelanto. La tabla quedó sin uso y se borra.

Resguardo: si en algún negocio la tabla tiene filas, la migración se detiene
en vez de borrar compras que alguien registró. Para seguir hay que decidir
qué hacer con esos datos (exportarlos o borrarlos a mano) y volver a correrla.

Plano tenant: corre en cada schema; donde la tabla no existe no hace nada.
El downgrade la vuelve a crear vacía, con su forma original.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e4b8d2f6a913"
down_revision: Union[str, None] = "c8d3e5f7a9b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "lead_sales"):
        return
    rows = bind.execute(sa.text("SELECT count(*) FROM lead_sales")).scalar_one()
    if rows:
        schema = bind.execute(sa.text("SELECT current_schema()")).scalar_one()
        raise RuntimeError(
            f"lead_sales tiene {rows} compras en el schema {schema}: no se borran sin decidir "
            "qué hacer con ellas. Expórtalas o bórralas a mano y vuelve a correr la migración."
        )
    op.drop_table("lead_sales")


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "lead_sales") or not _table_exists(bind, "leads") or not _table_exists(bind, "service_packages"):
        return
    op.create_table(
        "lead_sales",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=True),
        sa.Column("package_id", sa.Integer(), nullable=True),
        sa.Column("service_name", sa.Text(), nullable=False),
        sa.Column("package_name", sa.Text(), nullable=False),
        sa.Column("sessions", sa.Integer(), server_default="1", nullable=False),
        sa.Column("list_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sold_by_user_id", sa.Integer(), nullable=True),
        sa.Column("sold_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("sessions >= 1", name="lead_sales_sessions_check"),
        sa.CheckConstraint("list_price >= 0", name="lead_sales_list_price_check"),
        sa.CheckConstraint("amount >= 0", name="lead_sales_amount_check"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["service_id"], ["lead_services.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["package_id"], ["service_packages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["sold_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_lead_sales_lead_sold_at", "lead_sales", ["lead_id", sa.text("sold_at DESC")])
    op.create_index("idx_lead_sales_sold_at", "lead_sales", ["sold_at"])
    op.create_index("idx_lead_sales_sold_by", "lead_sales", ["sold_by_user_id"])
    op.create_index("idx_lead_sales_service", "lead_sales", ["service_id"])
    op.create_index("idx_lead_sales_package", "lead_sales", ["package_id"])



def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None
