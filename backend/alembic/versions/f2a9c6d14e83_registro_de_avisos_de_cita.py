"""Registro de cada aviso de WhatsApp de una cita.

Revision ID: f2a9c6d14e83
Revises: e5c1a8f37b42

El aviso al equipo iba directo al número de cada persona y no quedaba en la
base: solo una línea de log, que se borra con el tiempo, y sin forma de saber
si llegó. Ahora cada aviso (al cliente y a cada miembro del equipo) queda en
``appointment_notices`` con su resultado, y los estados de Meta lo marcan
como entregado o leído.

Plano tenant: corre en cada schema, también en `public`, donde producción no
tiene `appointments`. Solo crea la tabla donde la cita existe.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2a9c6d14e83"
down_revision: Union[str, None] = "e5c1a8f37b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "appointment_notices"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "appointments") or _table_exists(bind, TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "appointment_id", sa.BigInteger(),
            sa.ForeignKey("appointments.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("audience", sa.Text(), nullable=False),
        sa.Column("recipient_name", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("template_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("provider_message_id", sa.Text(), nullable=True),
        sa.Column("wsp_message_id", sa.BigInteger(), nullable=True),
        sa.Column("delivery_status", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("audience IN ('client', 'staff')", name="ck_appointment_notices_audience"),
        sa.CheckConstraint("status IN ('sent', 'failed', 'skipped')", name="ck_appointment_notices_status"),
        sa.CheckConstraint(
            "delivery_status IS NULL OR delivery_status IN ('sent', 'delivered', 'read', 'failed')",
            name="ck_appointment_notices_delivery",
        ),
    )
    op.create_index("idx_appointment_notices_appointment", TABLE, ["appointment_id"])
    op.create_index(
        "idx_appointment_notices_provider", TABLE, ["provider_message_id"], unique=True,
        postgresql_where=sa.text("provider_message_id IS NOT NULL"),
    )
    op.create_index(
        "idx_appointment_notices_wsp_message", TABLE, ["wsp_message_id"],
        postgresql_where=sa.text("wsp_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.drop_table(TABLE)
