"""Libro mayor de eventos de conversión de Meta.

Revision ID: c4e8b2a7d915
Revises: a3d7e9b1c5f2

Ver docs/analisis/14-diseno-api-conversiones-meta-ctwa.md §4.2.

``meta_conversion_events`` es la cola del worker y la deduplicación que Meta
no hace (``event_key`` único). Se borra con el lead y con su clic.

No toca ``wsp_ad``. La primera versión borraba los clics duplicados exactos y
creaba un índice único sobre ``ctwaclid``; el despliegue del 2026-11-14 falló
en DermicaPro porque n8n (``SUB - save CTWA``) guardó el mismo clic más de una
vez con datos distintos, y el índice no se pudo crear. Solo había corrido en
`public`, donde no hay ``wsp_ad``: no dejó nada. Ahora el clic repetido lo
evita la captura nativa (``attribution/repository.insert_click``) sin borrar
lo que ya está.

No copia histórico: Meta rechaza eventos de más de 7 días.

Plano tenant: corre en cada schema, también en `public`, donde producción
puede no tener `leads` ni `wsp_ad`.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4e8b2a7d915"
down_revision: Union[str, None] = "a3d7e9b1c5f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "meta_conversion_events"
CLICKS = "wsp_ad"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "leads") or not _table_exists(bind, CLICKS) or _table_exists(bind, TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "lead_id", postgresql.UUID(as_uuid=False),
            sa.ForeignKey("leads.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "wsp_ad_id", sa.BigInteger(),
            sa.ForeignKey(f"{CLICKS}.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("event_key", sa.Text(), nullable=False),
        sa.Column("event_name", sa.Text(), nullable=False),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("custom_data", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("skip_reason", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("meta_trace_id", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'skipped')",
            name="ck_meta_conversion_events_status",
        ),
    )
    op.create_index("uq_meta_conversion_events_key", TABLE, ["event_key"], unique=True)
    op.create_index("idx_meta_conversion_events_claim", TABLE, ["status", "next_attempt_at"])
    op.create_index("idx_meta_conversion_events_lead", TABLE, ["lead_id"])
    op.create_index("idx_meta_conversion_events_wsp_ad", TABLE, ["wsp_ad_id"])
    op.create_index("idx_meta_conversion_events_created", TABLE, [sa.text("created_at DESC")])


def downgrade() -> None:
    if _table_exists(op.get_bind(), TABLE):
        op.drop_table(TABLE)
