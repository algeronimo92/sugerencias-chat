"""plano de control multitenant y trabajos IA tenant

Revision ID: d2b7c4e91a60
Revises: c9a2e6f83d51
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import context, op


revision: str = "d2b7c4e91a60"
down_revision: Union[str, None] = "c9a2e6f83d51"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _upgrade_control_plane() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="provisioning", nullable=False),
        sa.Column("schema_name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('provisioning', 'active', 'suspended', 'failed', 'deleting')",
            name="organizations_status_check",
        ),
        sa.CheckConstraint(
            "schema_name ~ '^tenant_[0-9a-f]{32}$'",
            name="organizations_schema_name_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("schema_name"),
        schema="public",
    )
    op.create_table(
        "organization_domains",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("hostname", sa.Text(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("hostname = lower(hostname)", name="organization_domains_lower_check"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["public.organizations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hostname"),
        schema="public",
    )
    op.create_index(
        "uq_organization_domains_primary",
        "organization_domains",
        ["organization_id"],
        unique=True,
        schema="public",
        postgresql_where=sa.text("is_primary"),
    )
    op.create_table(
        "whatsapp_connections",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("phone_number_id", sa.Text(), nullable=False),
        sa.Column("waba_id", sa.Text(), nullable=True),
        sa.Column("encrypted_credentials", sa.Text(), nullable=True),
        sa.Column("secret_reference", sa.Text(), nullable=True),
        sa.Column("credential_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("status", sa.Text(), server_default="provisioning", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('provisioning', 'active', 'disabled', 'failed')",
            name="whatsapp_connections_status_check",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["public.organizations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("phone_number_id"),
        schema="public",
    )
    op.create_index(
        "idx_whatsapp_connections_organization",
        "whatsapp_connections",
        ["organization_id"],
        schema="public",
    )
    op.create_table(
        "tenant_schema_versions",
        sa.Column("organization_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("revision", sa.Text(), nullable=True),
        sa.Column("migration_status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "migration_status IN ('pending', 'running', 'current', 'failed')",
            name="tenant_schema_versions_status_check",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["public.organizations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("organization_id"),
        schema="public",
    )
    op.create_table(
        "webhook_inbox",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("event_key", sa.Text(), nullable=False),
        sa.Column("connection_key", sa.Text(), nullable=True),
        sa.Column("phone_number_id", sa.Text(), nullable=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        # Contiene datos del cliente solo hasta procesar/reconciliar el evento.
        # El rol de integración es el único lector y la operación debe podarlo.
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.Text(), server_default="received", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('received', 'processing', 'processed', 'failed')",
            name="webhook_inbox_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )
    op.create_index(
        "uq_webhook_inbox_provider_event",
        "webhook_inbox",
        ["provider", "event_key"],
        unique=True,
        schema="public",
    )
    op.create_index(
        "idx_webhook_inbox_pending",
        "webhook_inbox",
        ["status", "received_at"],
        schema="public",
    )

def _upgrade_tenant_plane() -> None:
    # Tabla del plano tenant: permanece sin schema explícito. Durante la etapa
    # de compatibilidad se crea junto al negocio legacy en public y se mueve con
    # las demás tablas; el migrador tenant la ejecuta con search_path apuntando
    # al schema aprovisionado.
    op.create_table(
        "ai_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("resource_id", sa.Text(), nullable=False),
        sa.Column("chat_id", sa.Text(), nullable=True),
        sa.Column("context_revision", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("request_metadata", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "operation IN ('rag', 'analyst', 'media_analysis')",
            name="ai_jobs_operation_check",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'failed', 'expired', 'applied')",
            name="ai_jobs_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_ai_jobs_status_expiry", "ai_jobs", ["status", "expires_at"])
    op.create_index("idx_ai_jobs_chat_created", "ai_jobs", ["chat_id", "created_at"])
    op.create_table(
        "knowledge_documents",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("document_type", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=False), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["knowledge_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_knowledge_chunks_document_ordinal",
        "knowledge_chunks",
        ["document_id", "ordinal"],
        unique=True,
    )
    op.create_index(
        "idx_knowledge_chunks_search_es",
        "knowledge_chunks",
        [sa.text("to_tsvector('spanish'::regconfig, content)")],
        postgresql_using="gin",
    )


def upgrade() -> None:
    # Al aprovisionar un schema se reproduce toda la cadena Alembic, pero esta
    # revisión omite las tablas compartidas. La ejecución normal las instala en
    # public y conserva ai_jobs allí solo para el tenant legacy hasta el cutover.
    if not context.config.attributes.get("tenant_schema"):
        _upgrade_control_plane()
    _upgrade_tenant_plane()


def downgrade() -> None:
    op.drop_index("idx_knowledge_chunks_search_es", table_name="knowledge_chunks")
    op.drop_index("uq_knowledge_chunks_document_ordinal", table_name="knowledge_chunks")
    op.drop_table("knowledge_chunks")
    op.drop_table("knowledge_documents")
    op.drop_index("idx_ai_jobs_chat_created", table_name="ai_jobs")
    op.drop_index("idx_ai_jobs_status_expiry", table_name="ai_jobs")
    op.drop_table("ai_jobs")
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_index("idx_webhook_inbox_pending", table_name="webhook_inbox", schema="public")
    op.drop_index("uq_webhook_inbox_provider_event", table_name="webhook_inbox", schema="public")
    op.drop_table("webhook_inbox", schema="public")
    op.drop_table("tenant_schema_versions", schema="public")
    op.drop_index(
        "idx_whatsapp_connections_organization",
        table_name="whatsapp_connections",
        schema="public",
    )
    op.drop_table("whatsapp_connections", schema="public")
    op.drop_index(
        "uq_organization_domains_primary",
        table_name="organization_domains",
        schema="public",
    )
    op.drop_table("organization_domains", schema="public")
    op.drop_table("organizations", schema="public")
