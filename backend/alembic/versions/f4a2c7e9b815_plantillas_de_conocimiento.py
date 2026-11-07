"""Plantillas de conocimiento que la plataforma ofrece a los negocios.

Revision ID: f4a2c7e9b815
Revises: e3f8a1c6d240
Create Date: 2026-11-07

Fichas de tratamientos, preguntas frecuentes y guiones modelo que un negocio
importa como copia propia (``knowledge_documents`` de su schema) y edita a su
gusto. La tabla vive una sola vez, en el plano de control.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op

revision: str = "f4a2c7e9b815"
down_revision: Union[str, None] = "e3f8a1c6d240"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plano de control: una sola vez, en public. Los schemas de cada negocio
    # no tienen nada que hacer en esta revisión.
    if context.config.attributes.get("tenant_schema"):
        return
    op.create_table(
        "knowledge_templates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("document_type", sa.Text(), nullable=True),
        sa.Column("service_hint", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "document_type IS NULL OR document_type IN ('ficha', 'politica', 'faq', 'guion', 'otro')",
            name="knowledge_templates_type_check",
        ),
        sa.CheckConstraint("version >= 1", name="knowledge_templates_version_check"),
        sa.PrimaryKeyConstraint("id"),
        schema="public",
    )


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_table("knowledge_templates", schema="public")
