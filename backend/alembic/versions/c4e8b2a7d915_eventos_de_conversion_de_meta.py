"""Eventos de conversión para la API de Conversiones de Meta.

Revision ID: c4e8b2a7d915
Revises: a3d7e9b1c5f2

Cuando un lead que llegó por un anuncio Click-to-WhatsApp agenda una cita, el
CRM se lo informa a Meta (``LeadSubmitted`` con el ``ctwa_clid`` del clic)
para que la campaña optimice hacia gente que agenda. Cada evento queda en
``meta_conversion_events`` y lo manda un worker con reintentos.

El clic se guardaba solo dentro del ``referral`` del primer mensaje; desde
ahora el webhook lo registra también en ``wsp_ad``, que existía para esto y
nadie escribía. Se copian los clics de los últimos 7 días, la ventana en la
que Meta todavía atribuye una conversión: los más viejos ya no sirven.

Plano tenant: corre en cada schema, también en `public`, donde producción no
tiene `leads`. Solo crea la tabla donde el lead existe.
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


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "leads") or _table_exists(bind, TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "lead_id", postgresql.UUID(as_uuid=False),
            sa.ForeignKey("leads.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("appointment_id", sa.BigInteger(), nullable=True),
        sa.Column("event_name", sa.Text(), nullable=False),
        sa.Column("ctwa_clid", sa.Text(), nullable=False),
        sa.Column("dataset_id", sa.Text(), nullable=False),
        sa.Column("waba_id", sa.Text(), nullable=False),
        sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("value", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("fbtrace_id", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed')", name="ck_meta_conversion_events_status"
        ),
    )
    op.create_index(
        "uq_meta_conversion_events_click", TABLE, ["ctwa_clid", "event_name"], unique=True,
    )
    op.create_index(
        "idx_meta_conversion_events_pending", TABLE, ["next_attempt_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "idx_meta_conversion_events_created", TABLE, [sa.text("created_at DESC")],
    )

    if _table_exists(bind, "wsp_ad") and _table_exists(bind, "wsp_messages"):
        # Un clic por ctwa_clid, el primer mensaje que lo trajo.
        bind.execute(sa.text("""
            INSERT INTO wsp_ad (
                lead_id, telefono, ctwaclid, mensaje, source_url,
                plataforma, procesado, fecha_interaccion
            )
            SELECT DISTINCT ON (m.provider_payload->'referral'->>'ctwa_clid')
                l.id,
                COALESCE(m.provider_payload->>'from', l.telefono, ''),
                m.provider_payload->'referral'->>'ctwa_clid',
                m.provider_payload->'referral'->>'body',
                m.provider_payload->'referral'->>'source_url',
                'whatsapp_ctwa',
                false,
                m.sent_at
            FROM wsp_messages m
            JOIN leads l ON l.id::text = m.chat_id::text
            WHERE m.sender = 'cliente'
              AND m.sent_at >= now() - interval '7 days'
              AND COALESCE(m.provider_payload->'referral'->>'ctwa_clid', '') <> ''
              AND NOT EXISTS (
                  SELECT 1 FROM wsp_ad a
                  WHERE a.ctwaclid = m.provider_payload->'referral'->>'ctwa_clid'
              )
            ORDER BY m.provider_payload->'referral'->>'ctwa_clid', m.sent_at
        """))


def downgrade() -> None:
    # Los clics copiados a wsp_ad se quedan: son datos válidos del negocio.
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.drop_table(TABLE)
