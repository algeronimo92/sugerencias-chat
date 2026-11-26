"""Recordatorios de cita leídos de Google Calendar.

Revision ID: b8e4d2a6c193
Revises: a3c7e1f95b20

Cada recordatorio (un día, cinco horas, una hora antes, o lo que configure
el negocio) queda en ``appointment_reminders``. La clave única evento +
anticipación + inicio es lo que impide mandarlo dos veces; los estados de
Meta lo marcan como entregado o leído.

Plano tenant: corre en cada schema, también en `public`, donde producción no
tiene `appointments`. Solo crea la tabla donde la cita existe.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8e4d2a6c193"
down_revision: Union[str, None] = "a3c7e1f95b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "appointment_reminders"


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
        sa.Column("calendar_event_id", sa.Text(), nullable=False),
        sa.Column("offset_minutes", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "appointment_id", sa.BigInteger(),
            sa.ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("event_summary", sa.Text(), server_default="", nullable=False),
        sa.Column("recipient_name", sa.Text(), server_default="", nullable=False),
        sa.Column("phone", sa.Text(), nullable=True),
        sa.Column("template_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("provider_message_id", sa.Text(), nullable=True),
        sa.Column("delivery_status", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'skipped')", name="ck_appointment_reminders_status",
        ),
        sa.CheckConstraint(
            "delivery_status IS NULL OR delivery_status IN ('sent', 'delivered', 'read', 'failed')",
            name="ck_appointment_reminders_delivery",
        ),
    )
    op.create_index(
        "uq_appointment_reminders_event_offset", TABLE,
        ["calendar_event_id", "offset_minutes", "starts_at"], unique=True,
    )
    op.create_index(
        "idx_appointment_reminders_provider", TABLE, ["provider_message_id"], unique=True,
        postgresql_where=sa.text("provider_message_id IS NOT NULL"),
    )
    op.create_index("idx_appointment_reminders_created", TABLE, [sa.text("created_at DESC")])


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.drop_table(TABLE)
