"""Contrato Meta, parte aditiva: payload del proveedor, subtipo y estados.

Revision ID: f3a8c2d7e915
Revises: b4c7d9e2f6a1

Agrega sin retirar nada:

- ``message_subtype``, ``provider_payload`` y ``webhook_event_id``: el mensaje
  tal como lo mandó Meta (o el cuerpo exacto que el CRM le envió) y el evento
  crudo del que salió. ``content``/``media_url``/``payload`` pasan a ser
  proyecciones para la UI.
- ``direction``: columna generada desde ``sender``, así nunca se contradicen.
- ``outbox_status``/``meta_status``/``status_payload``: el estado interno del
  envío separado del que informa Meta, con el evento completo.
- ``whatsapp_message_events``: cada estado y cada reacción tal como llegaron,
  para tolerar entregas duplicadas o fuera de orden.

Se elimina el CHECK cerrado sobre ``message_type``: la base tiene que poder
guardar un tipo que Meta agregue mañana. La lista de tipos conocidos vive en
``contracts/meta_messages.json`` y solo decide cómo mostrarlos.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "f3a8c2d7e915"
down_revision: Union[str, None] = "b4c7d9e2f6a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("wsp_messages", sa.Column("message_subtype", sa.Text(), nullable=True))
    op.add_column("wsp_messages", sa.Column("provider_payload", postgresql.JSONB(), nullable=True))
    op.add_column("wsp_messages", sa.Column("webhook_event_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.add_column("wsp_messages", sa.Column("outbox_status", sa.Text(), nullable=True))
    op.add_column("wsp_messages", sa.Column("meta_status", sa.Text(), nullable=True))
    op.add_column("wsp_messages", sa.Column("status_payload", postgresql.JSONB(), nullable=True))
    op.execute(
        "ALTER TABLE wsp_messages ADD COLUMN direction text GENERATED ALWAYS AS "
        "(CASE WHEN sender = 'cliente' THEN 'inbound' ELSE 'outbound' END) STORED"
    )
    op.execute("ALTER TABLE wsp_messages DROP CONSTRAINT IF EXISTS wsp_messages_message_type_check")
    op.create_check_constraint(
        "wsp_messages_outbox_status_check",
        "wsp_messages",
        "outbox_status IS NULL OR outbox_status IN "
        "('queued', 'sending', 'sent', 'retryable_failed', 'failed', 'discarded')",
    )

    op.create_table(
        "whatsapp_message_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("wa_message_id", sa.Text(), nullable=False),
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("leads.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("actor", sa.Text(), nullable=True),
        sa.Column("event_wa_id", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_payload", postgresql.JSONB(), nullable=False),
        sa.Column("webhook_event_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('status', 'reaction')", name="whatsapp_message_events_kind_check"),
        sa.CheckConstraint(
            "actor IS NULL OR actor IN ('customer', 'business')",
            name="whatsapp_message_events_actor_check",
        ),
    )
    op.create_index(
        "idx_whatsapp_message_events_target",
        "whatsapp_message_events",
        ["wa_message_id", "kind", "occurred_at"],
    )
    # Meta reintenta la entrega: el mismo estado del mismo mensaje con la
    # misma marca de tiempo es el mismo evento y no se vuelve a guardar.
    op.create_index(
        "uq_whatsapp_message_events_status",
        "whatsapp_message_events",
        ["wa_message_id", "value", "occurred_at"],
        unique=True,
        postgresql_where=sa.text("kind = 'status'"),
    )
    # Una reacción es un mensaje de Meta con id propio.
    op.create_index(
        "uq_whatsapp_message_events_event_wa_id",
        "whatsapp_message_events",
        ["event_wa_id"],
        unique=True,
        postgresql_where=sa.text("event_wa_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_table("whatsapp_message_events")
    op.drop_constraint("wsp_messages_outbox_status_check", "wsp_messages", type_="check")
    op.execute("ALTER TABLE wsp_messages DROP COLUMN direction")
    for column in (
        "status_payload", "meta_status", "outbox_status", "webhook_event_id",
        "provider_payload", "message_subtype",
    ):
        op.drop_column("wsp_messages", column)
