"""Agenda de contactos y sus importaciones.

Revision ID: d2b7e4f91a63
Revises: d7b2e4a91c36
Create Date: 2026-11-19

``contacts`` es la agenda del negocio, separada de ``leads``: un lead es un
contacto que entró al embudo. Las importaciones (CSV o la app WhatsApp
Business del celular) esperan en ``contact_import_rows`` hasta que alguien
elige cuáles pasan. ``whatsapp_app_syncs`` registra el pedido único que Meta
acepta en las 24 h siguientes a conectar el número, y
``whatsapp_history_chunks`` guarda el historial que Meta manda una sola vez.

La agenda arranca con los leads que ya existen, para que nadie que haya
escrito falte en ella.

Plano tenant: donde no está ``leads`` (public) no hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d2b7e4f91a63"
down_revision: Union[str, None] = "d7b2e4a91c36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "leads") or not _table_exists(bind, "users") or _table_exists(bind, "contacts"):
        return

    op.create_table(
        "contacts",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.func.gen_random_uuid(), nullable=False),
        sa.Column("nombre", sa.Text(), nullable=True),
        sa.Column("telefono", sa.Text(), nullable=True),
        sa.Column("wa_user_id", sa.Text(), nullable=True),
        sa.Column("username", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("etiquetas", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"), nullable=False),
        sa.Column("origen", sa.Text(), nullable=False),
        sa.Column("consentimiento_marketing", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("consentimiento_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("editado_en_crm_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("eliminado_en_app_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ultima_interaccion_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.CheckConstraint("origen IN ('manual', 'csv', 'whatsapp_app', 'lead')", name="contacts_origen_check"),
        sa.CheckConstraint("telefono IS NOT NULL OR wa_user_id IS NOT NULL", name="contacts_identity_check"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_contacts_telefono", "contacts", ["telefono"], unique=True,
        postgresql_where=sa.text("telefono IS NOT NULL"),
    )
    op.create_index(
        "uq_contacts_wa_user_id", "contacts", ["wa_user_id"], unique=True,
        postgresql_where=sa.text("wa_user_id IS NOT NULL"),
    )
    op.create_index("idx_contacts_lead", "contacts", ["lead_id"])
    op.create_index("idx_contacts_created", "contacts", [sa.text("created_at DESC")])
    op.create_index("idx_contacts_etiquetas", "contacts", ["etiquetas"], postgresql_using="gin")

    op.create_table(
        "contact_import_batches",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.func.gen_random_uuid(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="open", nullable=False),
        sa.Column("file_name", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("source IN ('csv', 'whatsapp_app')", name="contact_import_batches_source_check"),
        sa.CheckConstraint("status IN ('open', 'closed')", name="contact_import_batches_status_check"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_contact_import_batches_open_whatsapp", "contact_import_batches", ["source"], unique=True,
        postgresql_where=sa.text("status = 'open' AND source = 'whatsapp_app'"),
    )
    op.create_index("idx_contact_import_batches_created", "contact_import_batches", [sa.text("created_at DESC")])
    op.create_index("idx_contact_import_batches_created_by", "contact_import_batches", ["created_by_user_id"])

    op.create_table(
        "contact_import_rows",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=True),
        sa.Column("dedupe_key", sa.Text(), nullable=False),
        sa.Column("nombre", sa.Text(), nullable=True),
        sa.Column("telefono", sa.Text(), nullable=True),
        sa.Column("wa_user_id", sa.Text(), nullable=True),
        sa.Column("username", sa.Text(), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("notas", sa.Text(), nullable=True),
        sa.Column("etiquetas", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"), nullable=False),
        sa.Column("consentimiento", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("ultima_interaccion_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("contact_id", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "outcome IS NULL OR outcome IN ('created', 'updated', 'skipped', 'discarded')",
            name="contact_import_rows_outcome_check",
        ),
        sa.ForeignKeyConstraint(["batch_id"], ["contact_import_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_contact_import_rows_key", "contact_import_rows", ["batch_id", "dedupe_key"], unique=True)
    op.create_index(
        "idx_contact_import_rows_pending", "contact_import_rows", ["batch_id"],
        postgresql_where=sa.text("outcome IS NULL"),
    )
    op.create_index("idx_contact_import_rows_contact", "contact_import_rows", ["contact_id"])

    op.create_table(
        "whatsapp_app_syncs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("phone_number_id", sa.Text(), nullable=False),
        sa.Column("sync_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("request_id", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("progress", sa.SmallInteger(), nullable=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("sync_type IN ('smb_app_state_sync', 'history')", name="whatsapp_app_syncs_type_check"),
        sa.CheckConstraint(
            "status IN ('requested', 'failed', 'receiving', 'done', 'declined')",
            name="whatsapp_app_syncs_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_whatsapp_app_syncs_number_type", "whatsapp_app_syncs", ["phone_number_id", "sync_type"], unique=True,
    )

    op.create_table(
        "whatsapp_history_chunks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("phone_number_id", sa.Text(), nullable=False),
        sa.Column("phase", sa.SmallInteger(), nullable=True),
        sa.Column("chunk_order", sa.Integer(), nullable=True),
        sa.Column("progress", sa.SmallInteger(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_whatsapp_history_chunks_number", "whatsapp_history_chunks", ["phone_number_id", "phase", "chunk_order"],
    )

    op.create_table(
        "contact_settings",
        # Una sola fila (id = 1): sin secuencia, igual que el modelo.
        sa.Column("id", sa.SmallInteger(), autoincrement=False, nullable=False),
        sa.Column("auto_import_whatsapp", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("id = 1", name="contact_settings_single_row"),
        sa.PrimaryKeyConstraint("id"),
    )

    # Un contacto por número entre los leads que ya existen: si dos leads
    # comparten teléfono, queda enlazado el más antiguo. Los que solo tienen
    # BSUID entran por su identidad de WhatsApp.
    op.execute(r"""
        INSERT INTO contacts (nombre, telefono, wa_user_id, origen, lead_id, created_at, updated_at)
        SELECT DISTINCT ON (l.telefono)
               NULLIF(btrim(l.nombre), ''), l.telefono, NULL, 'lead', l.id,
               COALESCE(l.created_at, now()), now()
          FROM leads l
         WHERE l.telefono ~ '^[1-9][0-9]{7,14}$'
         ORDER BY l.telefono, l.created_at NULLS LAST
    """)
    op.execute(r"""
        INSERT INTO contacts (nombre, telefono, wa_user_id, origen, lead_id, created_at, updated_at)
        SELECT DISTINCT ON (wi.identifier)
               NULLIF(btrim(l.nombre), ''), NULL, wi.identifier, 'lead', l.id,
               COALESCE(l.created_at, now()), now()
          FROM leads l
          JOIN whatsapp_identities wi ON wi.lead_id = l.id AND wi.kind = 'user_id'
         WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.lead_id = l.id)
         ORDER BY wi.identifier, l.created_at NULLS LAST
    """)


def downgrade() -> None:
    for table in (
        "contact_settings", "whatsapp_history_chunks", "whatsapp_app_syncs",
        "contact_import_rows", "contact_import_batches", "contacts",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None
